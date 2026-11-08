// Web backend: page/asset delivery and the HTTP controllers.

import { readFileSync } from 'node:fs';
import { openStores } from './store.js';
import { createServices } from './services.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml' };
const MAX_BODY_BYTES = 64 * 1024;
const isClientId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);

const load = (name) => ({
  body: readFileSync(new URL(`../public/${name}`, import.meta.url)),
  type: TYPES[name.split('.').pop()],
});

class HttpError extends Error {
  constructor(status, outcome) {
    super(outcome);
    this.status = status;
    this.outcome = outcome;
  }
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'json_required');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (body === null || typeof body !== 'object') throw new HttpError(400, 'invalid_json');
  return body;
}

export function createApp({ dataDir, now = Date.now }) {
  const stores = openStores(dataDir);
  const { menuService, checkoutService } = createServices(stores, now);

  const assets = new Map(['styles.css', 'icon.svg', 'shared.js', 'customer.js'].map((n) => [`/assets/${n}`, load(`assets/${n}`)]));
  const pages = { customer: load('index.html') };

  const sendJson = (res, status, data) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const sendFile = (res, file) => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
    res.end(file.body);
  };

  async function route(req, res, path) {
    const { method } = req;
    if (method === 'GET' && path === '/api/menu') return sendJson(res, 200, menuService.getMenu());

    if (method === 'POST' && path === '/api/orders') {
      const { context, attempt, selection } = await readJson(req);
      if (!isClientId(context) || !isClientId(attempt)) throw new HttpError(400, 'invalid_attempt');
      const result = checkoutService.accept(context, attempt, selection);
      return sendJson(res, result.outcome === 'accepted' ? 200 : 422, result);
    }
    if (method === 'POST' && path === '/api/orders/recover') {
      const { context, attempt } = await readJson(req);
      if (!isClientId(context) || !isClientId(attempt)) throw new HttpError(400, 'invalid_attempt');
      const result = checkoutService.recover(context, attempt);
      return sendJson(res, result.outcome === 'rejected' ? 422 : 200, result);
    }

    if (method === 'GET' && path === '/') return sendFile(res, pages.customer);
    if (method === 'GET' && assets.has(path)) return sendFile(res, assets.get(path));
    return sendJson(res, 404, { outcome: 'not_found' });
  }

  const handler = (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    route(req, res, path).catch((error) => {
      if (!(error instanceof HttpError)) console.error(`Request failed: ${error.message}`); // never log URLs: tracking links are secrets
      if (!res.headersSent) sendJson(res, error.status ?? 503, { outcome: error.outcome ?? 'service_unavailable' });
      else res.destroy();
    });
  };

  return { handler, stores, close: () => stores.close() };
}
