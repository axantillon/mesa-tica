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

const load = (name) => ({
  body: readFileSync(new URL(`../public/${name}`, import.meta.url)),
  type: TYPES[name.split('.').pop()],
});

export function createApp({ dataDir, now = Date.now }) {
  const stores = openStores(dataDir);
  const { menuService } = createServices(stores, now);

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
    if (req.method === 'GET' && path === '/api/menu') return sendJson(res, 200, menuService.getMenu());
    if (req.method === 'GET' && path === '/') return sendFile(res, pages.customer);
    if (req.method === 'GET' && assets.has(path)) return sendFile(res, assets.get(path));
    return sendJson(res, 404, { outcome: 'not_found' });
  }

  const handler = (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    route(req, res, path).catch((error) => {
      console.error(`Request failed: ${error.message}`); // never log URLs: tracking links are secrets
      if (!res.headersSent) sendJson(res, error.status ?? 503, { outcome: error.outcome ?? 'service_unavailable' });
      else res.destroy();
    });
  };

  return { handler, stores, close: () => stores.close() };
}
