import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './config.js';
import { HttpError, sendError, sendJson } from './http/request.js';
import { customerRoutes } from './http/customer-routes.js';
import { staffRoutes } from './http/staff-routes.js';
import { createAccessService } from './services/access-service.js';
import { createCheckoutService } from './services/checkout-service.js';
import { createMenuService } from './services/menu-service.js';
import { createOrderService } from './services/order-service.js';
import { createTrackingService } from './services/tracking-service.js';
import { createIdentityStore } from './stores/identity-store.js';
import { createMenuStore } from './stores/menu-store.js';
import { createOrderStore } from './stores/order-store.js';
import { createRestaurantStore } from './stores/restaurant-store.js';

const publicDir = path.join(projectRoot, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PAGES = [
  { path: /^\/$/, file: 'index.html' },
  { path: /^\/staff\/?$/, file: 'staff.html' },
  { path: /^\/track\/[^/]*$/, file: 'track.html' },
];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export const systemClock = { now: () => new Date() };

/** Composes stores, policies-backed services and controllers into one request handler. */
export function createApp({ db, config, clock = systemClock }) {
  const restaurantStore = createRestaurantStore(db);
  const menuStore = createMenuStore(db);
  const orderStore = createOrderStore(db);
  const identityStore = createIdentityStore(db);

  const menuService = createMenuService({ menuStore, restaurantStore });
  const checkoutService = createCheckoutService({ menuStore, restaurantStore, orderStore, clock });
  const orderService = createOrderService({ orderStore, restaurantStore, clock });
  const trackingService = createTrackingService({ orderStore, restaurantStore });
  const accessService = createAccessService({ identityStore, sessionTtlMinutes: config.sessionTtlMinutes });

  const routes = [
    ...customerRoutes({ menuService, checkoutService, trackingService, clock }),
    ...staffRoutes({ accessService, orderService, config }),
  ];

  async function servePage(res, file) {
    const html = await fs.readFile(path.join(publicDir, file), 'utf8');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(html.replaceAll('%REFRESH_INTERVAL_MS%', String(config.refreshIntervalMs)));
  }

  async function serveAsset(res, pathname) {
    const file = path.normalize(path.join(publicDir, pathname));
    const type = CONTENT_TYPES[path.extname(file)];
    if (!file.startsWith(path.join(publicDir, 'assets') + path.sep) || !type) return false;
    try {
      const content = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(content);
      return true;
    } catch {
      return false;
    }
  }

  return async function handleRequest(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      const matching = routes
        .map((route) => ({ route, match: route.path.exec(pathname) }))
        .filter(({ match }) => match);
      if (matching.length > 0) {
        const found = matching.find(({ route }) => route.method === req.method);
        if (!found) throw new HttpError(405, 'method_not_allowed', 'This method is not allowed here.');
        return await found.route.handler(req, res, found.match.slice(1).map(decodeURIComponent), url);
      }

      if (req.method === 'GET') {
        const page = PAGES.find((candidate) => candidate.path.test(pathname));
        if (page) return await servePage(res, page.file);
        if (pathname.startsWith('/assets/') && (await serveAsset(res, pathname))) return;
      }
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Not found.');
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (error) {
      if (error instanceof HttpError) return sendError(res, error);
      if (error instanceof URIError) return sendError(res, new HttpError(400, 'invalid_request', 'The request path is malformed.'));
      // Unexpected failures are logged server-side only; clients get a generic temporary-failure reply.
      console.error('Request failed:', error);
      if (!res.headersSent) {
        sendJson(res, 503, { error: 'temporarily_unavailable', message: 'The service is temporarily unavailable. Please try again.' });
      } else {
        res.destroy();
      }
    }
  };
}
