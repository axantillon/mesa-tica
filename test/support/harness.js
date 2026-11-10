/**
 * Test-only harness: starts the real application handler on an isolated data directory with a controllable
 * clock. The clock and the direct database helpers exist only here; src/server.js always uses the system
 * clock and has no test hooks.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db.js';
import { CREDENTIALS_FILE, runSetup } from '../../src/setup.js';

/** Restaurant-local (UTC-6) reference instants. 2026-11-09 is a Monday. */
export const TIMES = {
  open: '2026-11-10T12:00:00-06:00',
  openingInstant: '2026-11-10T10:00:00-06:00',
  beforeOpening: '2026-11-10T09:59:59-06:00',
  lastOpenSecond: '2026-11-10T20:59:59-06:00',
  closingInstant: '2026-11-10T21:00:00-06:00',
};

export function makeDataDir(prefix = 'mesa-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Real time plus an adjustable offset, so time keeps moving after it is set. */
export function createTestClock(at) {
  let offsetMs = 0;
  const clock = {
    now: () => new Date(Date.now() + offsetMs),
    set(instant) {
      offsetMs = instant ? Date.parse(instant) - Date.now() : 0;
    },
  };
  clock.set(at);
  return clock;
}

export function readCredentials(dataDir) {
  const text = fs.readFileSync(path.join(dataDir, CREDENTIALS_FILE), 'utf8');
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => line.split('\t'))
      .map(([username, password]) => [username, password]),
  );
}

export async function startTestServer({ dataDir = makeDataDir(), clockAt = TIMES.open, env = {} } = {}) {
  const config = loadConfig({ MESA_DATA_DIR: dataDir, MESA_PORT: '0', MESA_REFRESH_INTERVAL_MS: '500', ...env });
  const db = openDatabase(config.dataDir);
  await runSetup({ db, config });
  const clock = createTestClock(clockAt);
  const server = http.createServer(createApp({ db, config, clock }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    db,
    clock,
    dataDir,
    credentials: readCredentials(dataDir),
    counts: () => counts(db),
    setMenuItem: (code, changes) => setMenuItem(db, code, changes),
    setWeeklyHours: (weeklyHours) => {
      const details = JSON.parse(db.prepare('SELECT details FROM restaurant WHERE id = 1').get().details);
      db.prepare('UPDATE restaurant SET details = ? WHERE id = 1').run(JSON.stringify({ ...details, weeklyHours }));
    },
    revokeAllSessions: () => db.prepare('DELETE FROM sessions').run(),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

export function counts(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    orders: count('orders'),
    orderItems: count('order_items'),
    attempts: count('submission_attempts'),
    statusChanges: count('status_changes'),
  };
}

export function setMenuItem(db, code, { price, available }) {
  if (price !== undefined) db.prepare('UPDATE menu_items SET price = ? WHERE code = ?').run(price, code);
  if (available !== undefined) db.prepare('UPDATE menu_items SET available = ? WHERE code = ?').run(available ? 1 : 0, code);
}

/** Small JSON client. `rawBody`/`contentType` let tests send malformed or non-JSON representations. */
export async function api(baseUrl, route, { method = 'GET', body, rawBody, contentType, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
  const response = await fetch(baseUrl + route, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

export async function signIn(baseUrl, username, password) {
  const response = await api(baseUrl, '/api/staff/session', { method: 'POST', body: { username, password } });
  if (response.status !== 200) throw new Error(`Sign-in failed with ${response.status}`);
  return response.headers.get('set-cookie').split(';')[0];
}

let idCounter = 0;
export function uniqueId(label = 'id') {
  idCounter += 1;
  return `${label}-${process.pid}-${idCounter}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 64).padEnd(16, 'x');
}

export const WORKED_SELECTION = [
  { code: 'M1', quantity: 1, reviewedPrice: 4500 },
  { code: 'S2', quantity: 1, reviewedPrice: 1400 },
  { code: 'D2', quantity: 2, reviewedPrice: 1000 },
];

export async function placeOrder(baseUrl, { context = uniqueId('ctx'), attempt = uniqueId('att'), selection = WORKED_SELECTION } = {}) {
  const response = await api(baseUrl, '/api/orders', { method: 'POST', body: { context, attempt, selection } });
  return { ...response, context, attempt };
}
