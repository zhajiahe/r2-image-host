import manifestJSON from '__STATIC_CONTENT_MANIFEST';
import { handleAuth } from './handlers/auth.js';
import { handleUpload } from './handlers/upload.js';
import {
  handleListFiles,
  handleDeleteFiles,
  handleStats,
} from './handlers/files.js';
import { handleCreateFolder, handleDeleteFolder } from './handlers/folders.js';
import { successRaw, error, notFound, methodNotAllowed } from './utils/response.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const AUTH_FREE_ROUTES = new Set(['POST /api/auth']);

const ROUTES = new Map([
  ['POST /api/auth', { handler: handleAuth }],
  ['POST /api/upload', { handler: handleUpload, auth: true }],
  ['GET /api/files', { handler: handleListFiles, auth: true }],
  ['DELETE /api/files', { handler: handleDeleteFiles, auth: true }],
  ['GET /api/stats', { handler: handleStats, auth: true }],
  ['POST /api/folders', { handler: handleCreateFolder, auth: true }],
  ['DELETE /api/folders', { handler: handleDeleteFolder, auth: true }],
]);

const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
};

const assetManifest = (() => {
  try {
    return manifestJSON ? JSON.parse(manifestJSON) : {};
  } catch (err) {
    console.warn('Failed to parse static asset manifest', err);
    return {};
  }
})();

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizeBindings(env) {
  const normalized = { ...env };

  if (!normalized.KV) {
    normalized.KV =
      env.KV ||
      env.INDEXES_KV ||
      env.IndexesKV ||
      env.indexesKV ||
      env.indexes_kv ||
      env.SESSIONS_KV;
  }

  if (!normalized.R2_BUCKET) {
    normalized.R2_BUCKET =
      env.R2_BUCKET ||
      env.R2 ||
      env.BUCKET ||
      env.bucket ||
      env.bucketBinding ||
      env.BucketBinding ||
      env['bucket-binding'];
  }

  return normalized;
}

async function enforceRateLimit(request, env) {
  if (!env.KV) {
    return null;
  }

  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';

  const key = `ratelimit:${ip}`;
  const limit = 100;
  const ttlSeconds = 3600;

  const current = parseInt((await env.KV.get(key)) || '0', 10);

  if (current >= limit) {
    return withCors(error('Rate limit exceeded', 429));
  }

  await env.KV.put(String(key), String(current + 1), { expirationTtl: ttlSeconds });
  return null;
}

async function getSession(request, env) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;

  if (!token) {
    return null;
  }

  const sessionKey = `session:${token}`;
  const session = await env.KV.get(sessionKey);
  return session ? { token, sessionKey } : null;
}

async function ensureAuthorized(request, env) {
  const session = await getSession(request, env);
  if (!session) {
    return withCors(error('Unauthorized', 401));
  }
  return session;
}

async function dispatch(request, env, ctx) {
  const url = new URL(request.url);
  const routeKey = `${request.method.toUpperCase()} ${url.pathname}`;

  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

  const route = ROUTES.get(routeKey);

  if (!route) {
    if (request.method === 'GET') {
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : notFound('Not found');
    }
    return withCors(notFound('Not found'));
  }

  if (!AUTH_FREE_ROUTES.has(routeKey)) {
    const rateLimitResponse = await enforceRateLimit(request, env);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const session = await ensureAuthorized(request, env);
    if (session instanceof Response) {
      return session;
    }
    request.session = session; // eslint-disable-line no-param-reassign
  }

  if (route.allowedMethods && !route.allowedMethods.includes(request.method)) {
    return withCors(methodNotAllowed(request.method));
  }

  try {
    const normalizedEnv = normalizeBindings(env);
    const response = await route.handler(request, normalizedEnv, ctx);
    return withCors(response instanceof Response ? response : successRaw(response));
  } catch (err) {
    console.error('Unhandled error:', err);
    return withCors(error('Internal Server Error', 500));
  }
}

async function serveStaticAsset(request, env) {
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    return env.ASSETS.fetch(request);
  }

  if (!env.__STATIC_CONTENT) {
    return null;
  }

  const url = new URL(request.url);
  let pathname = url.pathname.replace(/^\/+/, '');

  if (!pathname) {
    pathname = 'index.html';
  }

  const manifestKey =
    assetManifest[pathname] ||
    assetManifest[`${pathname}/index.html`] ||
    assetManifest['index.html'];

  if (!manifestKey) {
    return null;
  }

  const object = await env.__STATIC_CONTENT.get(manifestKey, {
    type: 'arrayBuffer',
  });

  if (!object) {
    return null;
  }

  const extension = pathname.split('.').pop().toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';

  return new Response(object, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await dispatch(request, normalizeBindings(env), ctx);

    if (response.status === 404 && request.method === 'GET') {
      const staticResponse = await serveStaticAsset(request, env);
      if (staticResponse) {
        return withCors(staticResponse);
      }
    }

    return response;
  },
};

