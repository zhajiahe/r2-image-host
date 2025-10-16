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

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function enforceRateLimit(request, env) {
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
    const response = await route.handler(request, env, ctx);
    return withCors(response instanceof Response ? response : successRaw(response));
  } catch (err) {
    console.error('Unhandled error:', err);
    return withCors(error('Internal Server Error', 500));
  }
}

export default {
  async fetch(request, env, ctx) {
    return dispatch(request, env, ctx);
  },
};

