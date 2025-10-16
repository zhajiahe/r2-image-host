export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init.headers,
    },
    ...init,
  });
}

export function success(data = {}) {
  return jsonResponse({ success: true, data });
}

export function successRaw(payload) {
  return jsonResponse({ success: true, ...payload });
}

export function error(message, status = 400, meta = {}) {
  return jsonResponse({ success: false, error: message, ...meta }, { status });
}

export function unauthorized(message = 'Unauthorized') {
  return error(message, 401);
}

export function forbidden(message = 'Forbidden') {
  return error(message, 403);
}

export function notFound(message = 'Not found') {
  return error(message, 404);
}

export function methodNotAllowed(method) {
  return error(`Method ${method} not allowed`, 405);
}

export function internalError(message = 'Internal Server Error') {
  return error(message, 500);
}

