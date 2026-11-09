// Web backend: page/asset delivery and the HTTP controllers.

import { readFileSync } from 'node:fs';
import { FILTERS, openStores } from './store.js';
import { createServices, SESSION_MS } from './services.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml' };
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = 'mesa_staff';
const ASSETS = ['styles.css', 'icon.svg', 'shared.js', 'customer.js', 'tracking.js', 'staff.js'];
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

const sessionToken = (req) => /(?:^|;\s*)mesa_staff=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];

export function createApp({ dataDir, now = Date.now, secureCookies = false }) {
  const stores = openStores(dataDir);
  const { menuService, checkoutService, trackingService, orderService, accessService } = createServices(stores, now);

  const assets = new Map(ASSETS.map((name) => [`/assets/${name}`, load(`assets/${name}`)]));
  const pages = { customer: load('index.html'), tracking: load('track.html'), staff: load('staff.html') };

  const sendJson = (res, status, data, headers = {}) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
  };
  const sendFile = (res, file, headers = {}) => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': 'no-cache', ...headers });
    res.end(file.body);
  };
  const sessionCookie = (value, maxAgeSeconds) => (
    `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/staff; Max-Age=${maxAgeSeconds}${secureCookies ? '; Secure' : ''}`
  );

  async function staffRoute(req, res, path, employee, token) {
    const { method } = req;
    if (method === 'GET' && path === '/api/staff/session') return sendJson(res, 200, { displayName: employee.displayName });
    if (method === 'POST' && path === '/api/staff/signout') {
      accessService.signOut(token);
      return sendJson(res, 200, { outcome: 'signed_out' }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (method === 'GET' && path === '/api/staff/orders') {
      const filter = new URL(req.url, 'http://localhost').searchParams.get('filter') ?? 'Active';
      if (!Object.hasOwn(FILTERS, filter)) throw new HttpError(400, 'invalid_filter');
      return sendJson(res, 200, orderService.listQueue(filter));
    }
    const orderMatch = /^\/api\/staff\/orders\/(\d{1,15})(\/status)?$/.exec(path);
    if (orderMatch && method === 'GET' && !orderMatch[2]) {
      const detail = orderService.getDetail(Number(orderMatch[1]));
      return sendJson(res, detail ? 200 : 404, detail ?? { outcome: 'unavailable' });
    }
    if (orderMatch && method === 'POST' && orderMatch[2]) {
      const { revision, target, reason } = await readJson(req);
      if (!Number.isInteger(revision)) throw new HttpError(400, 'invalid_revision');
      const result = orderService.changeStatus(Number(orderMatch[1]), revision, target, reason, employee);
      const status = { changed: 200, conflict: 409, invalid: 422, unavailable: 404 }[result.outcome];
      return sendJson(res, status, result);
    }
    return sendJson(res, 404, { outcome: 'not_found' });
  }

  async function route(req, res, path) {
    const { method } = req;

    if (method === 'POST' && path === '/api/staff/signin') {
      const { username, password } = await readJson(req);
      if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'invalid_credentials_format');
      const result = await accessService.signIn(username, password, req.socket.remoteAddress);
      if (result.outcome === 'limited') return sendJson(res, 429, { outcome: 'limited' });
      if (result.outcome === 'failed') return sendJson(res, 401, { outcome: 'failed' });
      return sendJson(res, 200, { outcome: 'signed_in', displayName: result.displayName }, { 'Set-Cookie': sessionCookie(result.token, SESSION_MS / 1000) });
    }
    // Single gate: every other /api/staff route requires a current authorized session.
    if (path.startsWith('/api/staff/')) {
      const token = sessionToken(req);
      const employee = accessService.requireStaff(token);
      if (!employee) return sendJson(res, 401, { outcome: 'sign_in_required' });
      return staffRoute(req, res, path, employee, token);
    }

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

    const trackMatch = /^\/api\/track\/([^/]*)$/.exec(path);
    if (method === 'GET' && trackMatch) {
      const snapshot = trackingService.getSnapshot(trackMatch[1]);
      return sendJson(res, snapshot ? 200 : 404, snapshot ?? { outcome: 'link_unavailable' });
    }

    if (method === 'GET' && path === '/') return sendFile(res, pages.customer);
    if (method === 'GET' && path === '/staff') return sendFile(res, pages.staff, { 'X-Robots-Tag': 'noindex' });
    if (method === 'GET' && (path === '/track' || path.startsWith('/track/'))) return sendFile(res, pages.tracking, { 'X-Robots-Tag': 'noindex' });
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
