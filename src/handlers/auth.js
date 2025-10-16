import { successRaw, error } from '../utils/response.js';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function handleAuth(request, env) {
  if (request.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('Invalid JSON body');
  }

  const { password } = body;

  if (!password || typeof password !== 'string') {
    return error('Password is required');
  }

  if (!env.APP_PASSWORD) {
    console.warn('APP_PASSWORD not set');
    return error('Server misconfiguration', 500);
  }

  if (password !== env.APP_PASSWORD) {
    return error('Invalid password', 401);
  }

  const token = crypto.randomUUID();
  const sessionKey = `session:${token}`;

  await env.KV.put(sessionKey, 'valid', {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return successRaw({ success: true, token });
}

