import { success, error } from '../utils/response.js';
import {
  buildObjectKey,
  parseFormData,
  sanitizePath,
  validateFileSize,
  validateFileType,
  validateMagicNumber,
} from '../utils/validator.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function handleUpload(request, env) {
  if (request.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  let form;
  try {
    form = await parseFormData(request);
  } catch (err) {
    return error('Invalid form data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return error('File is required');
  }

  const path = sanitizePath(form.get('path') || '');

  try {
    validateFileType(file);
    validateFileSize(file, MAX_FILE_SIZE);
    await validateMagicNumber(file);
  } catch (err) {
    return error(err.message);
  }

  const key = buildObjectKey({ basePath: path, originalName: file.name || 'upload' });

  const metadata = {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000',
    },
    customMetadata: {
      originalName: file.name,
      uploadTime: new Date().toISOString(),
      size: String(file.size),
    },
  };

  await env.R2_BUCKET.put(key, await file.arrayBuffer(), metadata);

  const publicDomain = env.R2_PUBLIC_DOMAIN || '';
  const url = publicDomain ? `${publicDomain.replace(/\/$/, '')}/${key}` : null;

  return success({
    key,
    url,
    filename: key.split('/').pop(),
    size: file.size,
    type: file.type,
  });
}

