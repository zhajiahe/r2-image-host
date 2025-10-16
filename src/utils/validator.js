const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const MAGIC_NUMBERS = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

export function sanitizePath(path = '') {
  const normalized = String(path)
    .trim()
    .replace(/\\+/g, '/');

  const safeSegments = normalized
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  return safeSegments.join('/');
}

export function validateFileType(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Unsupported file type');
  }
}

export async function validateMagicNumber(file) {
  const signature = MAGIC_NUMBERS[file.type];
  if (!signature) {
    return;
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer.slice(0, signature.length));

  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) {
      throw new Error('File content does not match type');
    }
  }
}

export function validateFileSize(file, maxSize) {
  if (file.size > maxSize) {
    throw new Error('File too large');
  }
}

export function buildObjectKey({ basePath = '', originalName }) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const timestamp = Date.now();
  const sanitizedName = originalName.replace(/[^a-z0-9._-]+/gi, '-');

  const safeBase = sanitizePath(basePath).replace(/\/+$/, '');
  const prefix = safeBase ? `${safeBase}/` : `${year}/${month}/`;

  return `${prefix}${timestamp}-${sanitizedName}`;
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
}

export async function parseFormData(request) {
  try {
    return await request.formData();
  } catch (error) {
    throw new Error('Invalid form data');
  }
}

