import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dataDirectory, openDatabase, readMenu, readRestaurant } from './store.js';
import { loginThrottle, requireStaff, signIn, signOut } from './access.js';
import { changeStatus, listQueue, staffDetail } from './staff.js';
import { HttpError, readJson } from './http.js';
import { acceptOrder, recoverOrder, trackOrder } from './orders.js';
import { openingState } from './opening.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/staff', ['staff.html', 'text/html; charset=utf-8']],
  ['/staff.js', ['staff.js', 'text/javascript; charset=utf-8']],
  ['/track', ['tracking.html', 'text/html; charset=utf-8']],
  ['/tracking.js', ['tracking.js', 'text/javascript; charset=utf-8']],
  ['/updates.js', ['updates.js', 'text/javascript; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/common.js', ['common.js', 'text/javascript; charset=utf-8']],
  ['/menu.js', ['menu.js', 'text/javascript; charset=utf-8']],
]);

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function application({
  directory = dataDirectory(),
  now = () => new Date(),
  secureCookies = process.env.MESA_SECURE_COOKIES === '1',
} = {}) {
  const db = openDatabase(directory);
  try {
    readRestaurant(db);
  } catch (error) {
    db.close();
    throw new Error('Database setup is required. Run npm run setup.', { cause: error });
  }
  const throttleLogin = loginThrottle();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const { pathname, searchParams } = new URL(req.url, 'http://mesa.local');
      if (req.method === 'POST' && ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
        throw new HttpError(403, 'same_origin_required');
      }
      if (req.method === 'GET' && pathname === '/api/menu') {
        const restaurant = readRestaurant(db);
        return json(res, 200, { restaurant, opening: openingState(restaurant, now()), menu: readMenu(db) });
      }
      if (req.method === 'POST' && ['/api/checkout/submit', '/api/checkout/check'].includes(pathname)) {
        const body = await readJson(req);
        return json(res, 200, pathname.endsWith('/submit') ? acceptOrder(db, body, now) : recoverOrder(db, body));
      }
      if (req.method === 'GET' && (pathname === '/api/track' || pathname.startsWith('/api/track/'))) {
        return json(res, 200, trackOrder(db, pathname.slice('/api/track/'.length)));
      }
      if (pathname.startsWith('/api/staff/')) {
        const authorize = () => requireStaff(db, req, now);
        if (req.method === 'POST' && pathname === '/api/staff/sign-in') {
          const credentials = await readJson(req);
          throttleLogin(req.socket.remoteAddress);
          const { employee, cookie } = await signIn(db, credentials, now, secureCookies);
          return json(res, 200, employee, { 'Set-Cookie': cookie });
        }
        if (req.method === 'POST' && pathname === '/api/staff/sign-out') {
          await readJson(req);
          return json(res, 200, {}, { 'Set-Cookie': signOut(db, req, secureCookies) });
        }
        if (req.method === 'GET' && pathname === '/api/staff/session') {
          return json(res, 200, { name: authorize().name });
        }
        if (req.method === 'GET' && pathname === '/api/staff/orders') {
          authorize();
          return json(res, 200, listQueue(db, searchParams.get('filter') ?? 'Active'));
        }
        const match = pathname.match(/^\/api\/staff\/orders\/([1-9]\d{0,14})$/);
        if (match && req.method === 'GET') {
          authorize();
          return json(res, 200, staffDetail(db, Number(match[1])));
        }
        if (match && req.method === 'POST') {
          authorize();
          const body = await readJson(req);
          const result = changeStatus(db, Number(match[1]), body, authorize, now);
          return json(res, result.outcome === 'conflict' ? 409 : 200, result);
        }
      }
      const asset = assets.get(pathname.startsWith('/track/') ? '/track' : pathname);
      if (req.method === 'GET' && asset) {
        const [file, type] = asset;
        const body = readFileSync(new URL('../public/' + file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(body);
      }
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { error: error.message });
      return json(res, 503, { error: 'service_unavailable' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.MESA_HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  application().listen(port, host, () => console.log('Mesa Tica listening on http://' + host + ':' + port));
}
