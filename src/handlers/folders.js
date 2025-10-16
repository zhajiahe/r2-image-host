import { success, error } from '../utils/response.js';
import { sanitizePath } from '../utils/validator.js';

async function deleteFolderRecursive(env, prefix) {
  let cursor;
  let deleted = 0;

  do {
    const list = await env.R2_BUCKET.list({ prefix, cursor, limit: 1000 });

    await Promise.all(
      list.objects.map((obj) => env.R2_BUCKET.delete(obj.key)),
    );

    deleted += list.objects.length;
    cursor = list.truncated ? list.cursor : null;
  } while (cursor);

  return deleted;
}

export async function handleCreateFolder(request, env) {
  if (request.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('Invalid JSON body');
  }

  const path = sanitizePath(body.path || '');
  if (!path) {
    return error('path is required');
  }

  const normalizedPath = path.endsWith('/') ? path : `${path}/`;
  const key = `${normalizedPath}.keep`;

  await env.R2_BUCKET.put(key, '', {
    httpMetadata: { contentType: 'text/plain' },
  });

  return success({ path: normalizedPath });
}

export async function handleDeleteFolder(request, env) {
  if (request.method !== 'DELETE') {
    return error('Method not allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('Invalid JSON body');
  }

  const path = sanitizePath(body.path || '');
  if (!path) {
    return error('path is required');
  }

  const normalizedPath = path.endsWith('/') ? path : `${path}/`;
  const deleted = await deleteFolderRecursive(env, normalizedPath);

  return success({ deleted, path: normalizedPath });
}

