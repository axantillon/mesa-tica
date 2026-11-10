import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { openStore, ClientError } from './store.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const identityPattern = /^[A-Za-z0-9_-]{32,100}$/;

export function createApplication({ filename = process.env.DATA_PATH || 'var/mesa.sqlite', now = () => new Date(), secureCookies = process.env.SECURE_COOKIES === 'true', sessionTtl = 8 * 60 * 60 * 1000 } = {}) {
  const store = openStore(filename);
  const loginLimits = new Map();
  let activeLogins = 0;
  const cookie = request => (request.headers.cookie || '').split('; ').find(part => part.startsWith('mesa_staff='))?.slice(11);
  const sessionCookie = (value, age) => `mesa_staff=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const server = http.createServer(async (request, response) => {
    const send = (status, data, extra = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
      response.end(JSON.stringify(data));
    };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://local');
      const path = url.pathname;
      const method = request.method;
      if (method !== 'GET' && method !== 'POST') throw new ClientError(405, 'Method not allowed.');
      if (method === 'POST' && request.headers.origin && request.headers.origin !== `${secureCookies ? 'https' : 'http'}://${request.headers.host}`) {
        throw new ClientError(403, 'This request origin is not allowed.');
      }
      // Authenticate before parsing protected bodies, so malformed requests reveal no staff data.
      const employee = path.startsWith('/api/staff/') ? store.requireStaff(cookie(request), now()) : null;
      let body;
      if (method === 'POST') {
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new ClientError(415, 'Send this request as application/json.');
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 32768) throw new ClientError(413, 'Request is too large.');
        }
        try { body = JSON.parse(raw); }
        catch { throw new ClientError(400, 'Malformed JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ClientError(400, 'Send a JSON object.');
      }
      if (path === '/api/menu' && method === 'GET') return send(200, store.menu(now()));
      if (['/api/checkout', '/api/attempts/check'].includes(path) && method === 'POST') {
        const scope = request.headers['x-customer-context'];
        if (!identityPattern.test(scope || '') || !identityPattern.test(body.attempt || '')) throw new ClientError(400, 'A valid private submission identity is required.');
        return send(200, path === '/api/checkout' ? store.submit(scope, body.attempt, body.selection, now()) : store.recover(scope, body.attempt));
      }
      if (path.startsWith('/api/tracking/') && method === 'GET') {
        return send(200, { order: store.tracking(path.slice('/api/tracking/'.length)), checkedAt: now().toISOString() });
      }
      if (path === '/api/login' && method === 'POST') {
        if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 100 || body.password.length > 256) throw new ClientError(400, 'Enter your staff username and password.');
        const ip = request.socket.remoteAddress;
        const timestamp = Date.now();
        for (const [key, value] of loginLimits) if (value.reset <= timestamp) loginLimits.delete(key);
        const limit = loginLimits.get(ip) || { count: 0, reset: timestamp + 60000 };
        if (limit.count >= 12 || activeLogins >= 4) throw new ClientError(429, 'Sign-in is temporarily limited. Wait one minute and try again.');
        limit.count++;
        loginLimits.set(ip, limit);
        activeLogins++;
        let user;
        try { user = await store.authenticate(body.username, body.password); }
        finally { activeLogins--; }
        const id = store.session(user, now(), sessionTtl);
        return send(200, { name: user.name }, { 'Set-Cookie': sessionCookie(id, Math.floor(sessionTtl / 1000)) });
      }
      if (path === '/api/logout' && method === 'POST') {
        store.signOut(cookie(request));
        return send(200, { message: 'Signed out.' }, { 'Set-Cookie': sessionCookie('', 0) });
      }
      if (path === '/api/staff/session' && method === 'GET') return send(200, employee);
      if (path === '/api/staff/orders' && method === 'GET') return send(200, { orders: store.queue(url.searchParams.get('filter') || 'Active'), checkedAt: now().toISOString() });
      const match = path.match(/^\/api\/staff\/orders\/(\d+)$/);
      if (match) {
        const number = Number(match[1]);
        if (method === 'GET') return send(200, { order: store.detail(number), checkedAt: now().toISOString() });
        if (!Number.isSafeInteger(body.revision) || typeof body.target !== 'string') throw new ClientError(400, 'Choose an action from the current order.');
        const currentEmployee = store.requireStaff(cookie(request), now());
        return send(200, { order: store.change(number, body.revision, body.target, body.reason, currentEmployee, now()), checkedAt: now().toISOString() });
      }
      const assets = { '/': 'index.html', '/track': 'index.html', '/staff': 'staff.html', '/app.js': 'app.js', '/staff.js': 'staff.js', '/shared.js': 'shared.js', '/style.css': 'style.css' };
      if (method === 'GET' && assets[path]) {
        const file = assets[path];
        const contents = await readFile(resolve(publicRoot, file));
        response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
        return response.end(contents);
      }
      throw new ClientError(404, 'Page or resource unavailable.');
    } catch (error) {
      if (!(error instanceof ClientError)) console.error('Request failed:', error.code || error.name);
      return send(error.status || 503, { message: error.status ? error.message : 'Service unavailable. Try again; a submitted action may have completed.', ...error.extra });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, store } = createApplication();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  server.listen(port, host, () => console.log(`Mesa Tica listening at http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
}
