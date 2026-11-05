import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dataDirectory, openDatabase, readMenu, readRestaurant } from './store.js';
import { openingState } from './opening.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/menu.js', ['menu.js', 'text/javascript; charset=utf-8']],
]);

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function application({ directory = dataDirectory(), now = () => new Date() } = {}) {
  const db = openDatabase(directory);
  try {
    readRestaurant(db);
  } catch (error) {
    db.close();
    throw new Error('Database setup is required. Run npm run setup.', { cause: error });
  }
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const { pathname } = new URL(req.url, 'http://mesa.local');
      if (req.method === 'GET' && pathname === '/api/menu') {
        const restaurant = readRestaurant(db);
        return json(res, 200, { restaurant, opening: openingState(restaurant, now()), menu: readMenu(db) });
      }
      if (req.method === 'GET' && assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        const body = readFileSync(new URL('../public/' + file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(body);
      }
      return json(res, 404, { error: 'not_found' });
    } catch {
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
