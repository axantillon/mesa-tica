// Runs the real app against isolated data with a controllable clock. Test-only; production has no such hook.

import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { runSetup } from '../src/setup.js';

/** Monday 2026-11-09 12:00 in Costa Rica (UTC-6, no daylight saving). */
export const OPEN_NOON = Date.UTC(2026, 10, 9, 18, 0, 0);
export const costaRica = (day, hour, minute = 0, second = 0) => Date.UTC(2026, 10, day, hour + 6, minute, second);

export const freshDataDir = () => mkdtempSync(join(tmpdir(), 'mesa-test-'));
export const removeDataDir = (dataDir) => rmSync(dataDir, { recursive: true, force: true });

export function readCredentials(dataDir) {
  return Object.fromEntries(readFileSync(join(dataDir, 'staff-credentials.local.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
}

export async function startApp({ dataDir = freshDataDir(), at = OPEN_NOON } = {}) {
  runSetup(dataDir);
  const clock = { t: at };
  const app = createApp({ dataDir, now: () => clock.t });
  const server = createServer(app.handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const db = app.stores.db;
  return {
    base,
    clock,
    db,
    dataDir,
    credentials: readCredentials(dataDir),
    setPrice: (id, price) => db.prepare('UPDATE menu_items SET price = ? WHERE id = ?').run(price, id),
    setAvailable: (id, available) => db.prepare('UPDATE menu_items SET available = ? WHERE id = ?').run(available ? 1 : 0, id),
    /** Stops serving but keeps the data directory, to prove restart durability. */
    async shutdown() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      app.close();
    },
    async stop() {
      await this.shutdown();
      removeDataDir(dataDir);
    },
  };
}
