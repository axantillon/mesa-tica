/** Request-boundary helpers shared by every controller: representation checks, value checks and replies. */

const MAX_BODY_BYTES = 16 * 1024;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new HttpError(400, 'invalid_request', message);

/** Reads a JSON body: 415 for any other media type, 413 when too large, 400 when malformed. */
export async function readJson(req) {
  const mediaType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Send the request body as application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', 'The request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'malformed_json', 'The request body is not valid JSON.');
  }
}

export function requireObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw badRequest('The request body must be a JSON object.');
  return value;
}

export function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) {
    throw badRequest(`${field} must be a 16–64 character identifier.`);
  }
  return value;
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function sendError(res, error) {
  sendJson(res, error.status, { error: error.code, message: error.message });
}

export function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // A malformed cookie value is ignored, which leaves the request unauthenticated.
    }
  }
  return cookies;
}
