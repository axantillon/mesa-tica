// Test helpers: a real server on a temporary DATA_DIR with an injected clock. Not a test file itself.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setup } from '../setup.js';
import { createApp } from '../server.js';

export const PASSWORDS = { STAFF_PASSWORD_LUIS: 'luis-test-password', STAFF_PASSWORD_ELENA: 'elena-test-password' };
export const FRIDAY_NOON_CR = '2026-11-06T18:00:00.000Z'; // 12:00 in Costa Rica (UTC-6)
export const LUNCH = [
  { code: 'M1', price: 4500, quantity: 1 },
  { code: 'S2', price: 1400, quantity: 1 },
  { code: 'D2', price: 1000, quantity: 2 },
];

export const newId = () => randomBytes(12).toString('hex');

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mesa-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export async function startApp(t, { dataDir = tempDir(t), now = FRIDAY_NOON_CR } = {}) {
  setup(dataDir, PASSWORDS, () => {});
  const clock = { now: new Date(now) };
  const server = createApp({ dataDir, now: () => clock.now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
  t.after(() => server.listening && stop());

  async function call(method, path, body, headers = {}) {
    if (typeof headers === 'string') headers = { Cookie: headers };
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, text, headers: res.headers };
  }

  const place = (items = LUNCH, submissionId = newId()) => call('POST', '/api/orders', { submissionId, items });

  async function signIn(username = 'luis') {
    const res = await call('POST', '/api/staff/sign-in', { username, password: PASSWORDS[`STAFF_PASSWORD_${username.toUpperCase()}`] });
    return res.headers.get('set-cookie')?.split(';')[0];
  }

  const changeStatus = (cookie, number, version, to, reason) =>
    call('POST', `/api/staff/orders/${number}/status`, { version, to, reason }, cookie);

  // Read the database directly (a second connection), to count rows.
  function rows(sql, ...params) {
    const db = new DatabaseSync(join(dataDir, 'mesa.sqlite'));
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  }

  return { base, clock, dataDir, call, place, signIn, changeStatus, rows, stop };
}

export const tokenOf = (order) => order.trackingLink.replace('/track/', '');
