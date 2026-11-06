// One node:http server: the three pages, their scripts, and the JSON API (one route per controller method).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, RestaurantStore, OrderStore, StaffStore } from './shared/stores.js';
import { OrderingController } from './a-ordering/OrderingController.js';
import { StaffController } from './b-staff/StaffController.js';
import { TrackingController } from './c-tracking/TrackingController.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
// Only these files are served. Controllers and stores never are.
const FILES = {
  '/': 'a-ordering/menu.html',
  '/staff': 'b-staff/staff.html',
  '/a-ordering/MenuPage.js': 'a-ordering/MenuPage.js',
  '/a-ordering/Cart.js': 'a-ordering/Cart.js',
  '/b-staff/StaffPage.js': 'b-staff/StaffPage.js',
  '/c-tracking/TrackingPage.js': 'c-tracking/TrackingPage.js',
  '/shared/Poller.js': 'shared/Poller.js',
  '/shared/ui.js': 'shared/ui.js',
  '/shared/style.css': 'shared/style.css',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
};
const COOKIE = 'mesa_session';
const MAX_BODY = 64 * 1024;

// Server clock. TEST_NOW (ISO) starts it at a fixed instant, then it runs normally.
export function serverClock(testNow) {
  if (!testNow) return () => new Date();
  const start = Date.parse(testNow);
  if (Number.isNaN(start)) throw new Error(`TEST_NOW is not a date: ${testNow}`);
  const boot = Date.now();
  return () => new Date(start + (Date.now() - boot));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return {};
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const sendJson = (res, { status, body }, headers = {}) =>
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, JSON.stringify(body));

const sessionIdFrom = (req) => (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];

export function createApp({ dataDir, now = () => new Date() }) {
  const db = openDatabase(dataDir);
  const restaurantStore = new RestaurantStore(db);
  const orderStore = new OrderStore(db, now);
  const staffStore = new StaffStore(db, now);
  if (!restaurantStore.readRestaurant()) {
    db.close();
    throw new Error(`No restaurant in ${dataDir}. Run "npm run setup" first.`);
  }
  const ordering = new OrderingController(restaurantStore, orderStore, now);
  const tracking = new TrackingController(orderStore, restaurantStore);
  const staff = (req) => new StaffController(orderStore, staffStore, sessionIdFrom(req));

  async function handle(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const method = req.method;
    let m;

    if (method === 'GET' && pathname === '/api/menu') return sendJson(res, ordering.getMenu());
    if (method === 'POST' && pathname === '/api/orders') {
      const { submissionId, items } = await readJson(req);
      return sendJson(res, ordering.placeOrder(submissionId, items));
    }
    if (method === 'POST' && pathname === '/api/staff/sign-in') {
      const { username, password } = await readJson(req);
      const result = staff(req).signIn(username, password);
      if (!result.session) return sendJson(res, result);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      const maxAge = Math.round((Date.parse(result.session.expiresAt) - now().getTime()) / 1000);
      const cookie = `${COOKIE}=${result.session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
      return sendJson(res, result, { 'Set-Cookie': cookie });
    }
    if (method === 'GET' && pathname === '/api/staff/orders') return sendJson(res, staff(req).listOrders(searchParams.get('status')));
    if (method === 'GET' && (m = pathname.match(/^\/api\/staff\/orders\/([^/]+)$/))) return sendJson(res, staff(req).getOrder(m[1]));
    if (method === 'POST' && (m = pathname.match(/^\/api\/staff\/orders\/([^/]+)\/status$/))) {
      const { version, to, reason } = await readJson(req);
      return sendJson(res, staff(req).changeStatus(m[1], version, to, reason));
    }
    if (method === 'GET' && (m = pathname.match(/^\/api\/track\/([^/]*)$/))) return sendJson(res, tracking.getTracking(m[1]));
    if (pathname.startsWith('/api/')) return sendJson(res, { status: 404, body: { reason: 'not_found' } });

    const file = method === 'GET' && (FILES[pathname] ?? (/^\/track\/[^/]+$/.test(pathname) && 'c-tracking/track.html'));
    if (!file) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    const type = TYPES[file.split('.').pop()];
    return send(res, 200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' }, await readFile(ROOT + file));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, { status: 500, body: { reason: 'server_error' } });
      else res.destroy();
    });
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const server = createApp({ dataDir: process.env.DATA_DIR || './data', now: serverClock(process.env.TEST_NOW) });
  server.listen(port, '0.0.0.0', () => console.log(`Mesa Tica on http://0.0.0.0:${port}`));
  process.on('SIGTERM', () => server.close());
}
