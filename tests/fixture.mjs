import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';
import { token } from '../src/store.mjs';

export const openTime = '2026-11-09T16:00:00Z';
export const closedTime = '2026-11-10T03:00:00Z';
export const selection = [
  { id: 'M1', price: 4500, quantity: 1 },
  { id: 'S2', price: 1400, quantity: 1 },
  { id: 'D2', price: 1000, quantity: 2 },
];
export const staffPassword = () => token();
export async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mesa-test-'));
  const filename = join(directory, 'orders.sqlite');
  let clock = new Date(openTime);
  let app = createApplication({ filename, now: () => clock });
  const password = staffPassword();
  await app.store.provision('luis', 'Luis Ramírez', password);
  await app.store.provision('elena', 'Elena Vargas', password);
  async function listen() {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  let base = await listen();
  return {
    directory, filename, password,
    get store() { return app.store; },
    get base() { return base; },
    setTime(value) { clock = new Date(value); },
    setting(key, value) { app.store.db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value), key); },
    count() { return app.store.db.prepare('SELECT count(*) AS n FROM orders').get().n; },
    async request(path, { method = 'GET', body, cookie, context, raw, contentType = 'application/json' } = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': contentType, ...(cookie ? { Cookie: cookie } : {}), ...(context ? { 'X-Customer-Context': context } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
    },
    async login(username = 'luis') { return this.request('/api/login', { method: 'POST', body: { username, password } }); },
    async place(chosen = selection, context = token(), attempt = token()) {
      return { ...(await this.request('/api/checkout', { method: 'POST', context, body: { attempt, selection: chosen } })), context, attempt };
    },
    async restart() {
      await new Promise(resolve => app.server.close(resolve)); app.store.db.close();
      app = createApplication({ filename, now: () => clock }); base = await listen();
    },
    async close() { await new Promise(resolve => app.server.close(resolve)); app.store.db.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
