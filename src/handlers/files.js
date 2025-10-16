import { success, error } from '../utils/response.js';
import { formatBytes, sanitizePath } from '../utils/validator.js';

const DEFAULT_LIST_LIMIT = 100;

function parseListParams(url) {
  const params = new URLSearchParams(url.search);
  const rawPrefix = params.get('prefix') || '';
  const sanitizedPrefix = sanitizePath(rawPrefix);
  const prefix = sanitizedPrefix && rawPrefix.endsWith('/') ? `${sanitizedPrefix}/` : sanitizedPrefix;
  const limit = Math.min(parseInt(params.get('limit') || DEFAULT_LIST_LIMIT, 10), 1000);
  const cursor = params.get('cursor') || undefined;
  return { prefix, limit, cursor };
}

export async function handleListFiles(request, env) {
  if (request.method !== 'GET') {
    return error('Method not allowed', 405);
  }

  const { prefix, limit, cursor } = parseListParams(new URL(request.url));

  const list = await env.R2_BUCKET.list({ prefix, limit, cursor, delimiter: '/' });

  const files = list.objects.map((obj) => ({
    key: obj.key,
    name: obj.key.split('/').pop(),
    size: obj.size,
    uploaded: obj.uploaded?.toISOString?.() || null,
    url: env.R2_PUBLIC_DOMAIN
      ? `${env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${obj.key}`
      : null,
    type: obj.httpMetadata?.contentType || null,
  }));

  return success({
    files,
    folders: list.delimitedPrefixes || [],
    truncated: list.truncated,
    cursor: list.cursor || null,
  });
}

function parseHistoryParams(url) {
  const params = new URLSearchParams(url.search);
  const rawPrefix = params.get('prefix') || '';
  const sanitizedPrefix = sanitizePath(rawPrefix);
  const prefix = sanitizedPrefix && rawPrefix.endsWith('/') ? `${sanitizedPrefix}/` : sanitizedPrefix;
  const limit = Math.min(parseInt(params.get('limit') || 200, 10), 1000);
  return { prefix, limit };
}

const HISTORY_SCAN_LIMIT = 2000;

function formatHistoryObject(obj, env) {
  const uploadedIso = obj.uploaded?.toISOString?.() || obj.customMetadata?.uploadTime || null;
  const url = env.R2_PUBLIC_DOMAIN
    ? `${env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${obj.key}`
    : null;

  return {
    key: obj.key,
    name: obj.key.split('/').pop(),
    size: obj.size,
    uploaded: uploadedIso,
    url,
    type: obj.httpMetadata?.contentType || null,
  };
}

export async function handleHistory(request, env) {
  if (request.method !== 'GET') {
    return error('Method not allowed', 405);
  }

  const { prefix, limit } = parseHistoryParams(new URL(request.url));

  let cursor;
  const collected = [];

  do {
    const list = await env.R2_BUCKET.list({ prefix, cursor, limit: Math.min(1000, limit) });
    collected.push(...list.objects.map((obj) => formatHistoryObject(obj, env)));
    cursor = list.truncated ? list.cursor : null;

    if (!cursor || collected.length >= HISTORY_SCAN_LIMIT) {
      break;
    }
  } while (cursor);

  const sorted = collected.sort((a, b) => {
    const aTime = a.uploaded ? Date.parse(a.uploaded) : 0;
    const bTime = b.uploaded ? Date.parse(b.uploaded) : 0;
    return bTime - aTime;
  });

  const files = sorted.slice(0, limit);
  const hasMore = collected.length > limit || Boolean(cursor);

  return success({
    files,
    total: collected.length,
    hasMore,
  });
}

export async function handleDeleteFiles(request, env) {
  if (request.method !== 'DELETE') {
    return error('Method not allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('Invalid JSON body');
  }

  const { keys } = body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return error('keys must be a non-empty array');
  }

  await Promise.all(keys.map((key) => env.R2_BUCKET.delete(sanitizePath(key))));

  return success({ deleted: keys.length });
}

export async function handleStats(request, env) {
  if (request.method !== 'GET') {
    return error('Method not allowed', 405);
  }

  let cursor;
  let totalSize = 0;
  let totalFiles = 0;
  const recentUploads = [];

  do {
    const list = await env.R2_BUCKET.list({ cursor, limit: 1000 });
    list.objects.forEach((obj) => {
      totalFiles += 1;
      totalSize += obj.size || 0;
      if (recentUploads.length < 10) {
        recentUploads.push({
          key: obj.key,
          uploaded: obj.uploaded?.toISOString?.() || null,
        });
      }
    });
    cursor = list.truncated ? list.cursor : null;
  } while (cursor);

  return success({
    totalFiles,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    recentUploads,
  });
}

