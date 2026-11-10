import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fixture, selection, openTime, closedTime } from './fixture.mjs';
import { token } from '../src/store.mjs';
import { opening } from '../src/policies.mjs';
import { restaurant } from '../src/sample.mjs';

async function isolated(t) { const f = await fixture(); t.after(() => f.close()); return f; }
test('SETUP / RUN: repeatable setup, distinct staff, durable data/history and nondefault listener', async t => {
  const f = await isolated(t);
  assert.equal(f.count(), 0);
  const first = await f.place();
  const login = await f.login();
  await f.request('/api/staff/orders/1', { method: 'POST', cookie: login.cookie, body: { revision: 1, target: 'Preparing' } });
  execFileSync(process.execPath, ['src/setup.mjs'], { env: { ...process.env, DATA_PATH: f.filename }, stdio: 'pipe' });
  assert.equal((await f.login()).status, 200, 'setup preserved password');
  assert.equal((await f.login('elena')).data.name, 'Elena Vargas');
  await f.restart();
  assert.equal(f.count(), 1);
  const restored = await f.request(`/api/tracking/${first.data.privateKey}`);
  assert.equal(restored.data.order.status, 'Preparing');
  const detail = await f.request('/api/staff/orders/1', { cookie: login.cookie });
  assert.equal(detail.data.order.history[0].employee, 'Luis Ramírez');
  // Exercise actual executable environment settings, not only the factory's options.
  const child = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_PATH: f.filename }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const [chunk] = await once(child.stdout, 'data');
  const address = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  assert.notEqual(new URL(address).port, '3000');
  const response = await fetch(`${address}/api/tracking/${first.data.privateKey}`);
  assert.equal((await response.json()).order.status, 'Preparing');
  child.kill(); await once(child, 'exit');
});

test('A1: sample content, local boundaries and no upcoming opening', async t => {
  const f = await isolated(t);
  const menu = (await f.request('/api/menu')).data;
  assert.equal(menu.items.length, 9);
  assert.equal(menu.items.find(item => item.id === 'M3').available, false);
  assert.equal(menu.opening.isOpen, true);
  assert.equal(opening(restaurant, new Date('2026-11-09T15:59:59Z')).isOpen, false);
  assert.equal(opening(restaurant, new Date(openTime)).isOpen, true);
  assert.equal(opening(restaurant, new Date('2026-11-10T02:59:59Z')).isOpen, true);
  assert.equal(opening(restaurant, new Date(closedTime)).isOpen, false);
  assert.match(opening(restaurant, new Date(closedTime)).message, /Tuesday, Nov 10, 10:00 AM/);
  f.setting('restaurant', { ...restaurant, hours: [] });
  assert.match((await f.request('/api/menu')).data.opening.message, /no upcoming opening.*not monitored/);
  assert.equal((await f.place()).data.outcome, 'rejected');
  assert.equal(f.count(), 0);
});

test('A2/A3: exact worked total, integer quantities, empty/unknown/unavailable/closed no-write', async t => {
  const f = await isolated(t);
  const accepted = await f.place();
  assert.equal(accepted.data.order.total, 7900);
  assert.equal(accepted.data.order.status, 'Received');
  assert.equal((await f.place([selection[0], selection[1], { ...selection[2], quantity: 3 }])).data.order.total, 8900);
  assert.equal((await f.place([selection[0], selection[2]])).data.order.total, 6500);
  for (const quantity of [0, -1, 1.5, 'one', '2', null]) assert.equal((await f.place([{ ...selection[0], quantity }])).data.outcome, 'rejected');
  for (const chosen of [[], [{ id: 'M3', price: 5000, quantity: 1 }], [{ id: 'missing', price: 1, quantity: 1 }]]) assert.equal((await f.place(chosen)).data.outcome, 'rejected');
  f.setTime(closedTime);
  assert.equal((await f.place()).data.outcome, 'rejected');
  assert.equal(f.count(), 3);
});

test('A3-REVIEW/B2: both price directions need review; accepted snapshot survives menu replacement', async t => {
  const f = await isolated(t);
  const first = await f.place();
  const menu = f.store.readSetting('menu');
  menu[0].price = 4600;
  f.setting('menu', menu);
  const rejected = await f.place();
  assert.equal(rejected.data.outcome, 'rejected');
  assert.equal(rejected.data.corrections[0].price, 4600);
  assert.equal(f.count(), 1);
  const reviewed = await f.place(selection.map(item => item.id === 'M1' ? { ...item, price: 4600 } : item));
  assert.equal(reviewed.data.order.total, 8000);
  menu[0].price = 4400;
  f.setting('menu', menu);
  assert.equal((await f.place()).data.outcome, 'rejected');
  f.setting('menu', []);
  const login = await f.login();
  const detail = (await f.request('/api/staff/orders/1', { cookie: login.cookie })).data.order;
  assert.equal(detail.items[0].name, 'Chicken casado');
  assert.equal(detail.items[0].price, 4500);
  assert.equal(detail.total, 7900);
  assert.equal((await f.request(`/api/tracking/${first.data.privateKey}`)).data.order.total, 7900);
});

test('A4: accepted/closed outcomes are scoped, durable and bound to their first selection', async t => {
  const f = await isolated(t);
  const context = token(), attempt = token();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.place(selection, context, attempt)));
  assert.equal(new Set(results.map(result => result.data.order.number)).size, 1);
  assert.equal(f.count(), 1);
  f.setTime(closedTime);
  f.setting('menu', []);
  assert.equal((await f.place([], context, attempt)).data.order.number, 1);
  const recover = () => f.request('/api/attempts/check', { method: 'POST', context, body: { attempt } });
  assert.equal((await recover()).data.order.number, 1);
  const wrong = await f.request('/api/attempts/check', { method: 'POST', context: token(), body: { attempt } });
  assert.deepEqual(wrong.data, { outcome: 'uncertain' });
  const rejected = await f.place();
  await f.restart();
  f.setTime(openTime);
  const original = (await f.request('/api/attempts/check', { method: 'POST', context: rejected.context, body: { attempt: rejected.attempt } })).data;
  assert.deepEqual(original, rejected.data);
  assert.deepEqual((await f.place(selection, rejected.context, rejected.attempt)).data, rejected.data);
  assert.equal(f.count(), 1);
});

test('B1/B3/ACCESS/REQUEST: authorization, filters, representation, cancellation and legal lifecycle', async t => {
  const f = await isolated(t);
  const first = await f.place();
  assert.equal((await f.request('/api/staff/orders')).status, 401);
  assert.equal((await f.request('/api/staff/orders/1', { method: 'POST', body: { revision: 1, target: 'Preparing' } })).status, 401);
  assert.equal((await f.request('/api/staff/orders', { cookie: `mesa_staff=${first.data.privateKey}` })).status, 401);
  const login = await f.login();
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = login.cookie;
  assert.equal((await f.request('/api/staff/orders?filter=Unknown', { cookie })).status, 400);
  for (const path of ['/api/checkout', '/api/login', '/api/logout', '/api/attempts/check', '/api/staff/orders/1']) {
    assert.equal((await f.request(path, { method: 'POST', cookie, raw: '{' })).status, 400);
    assert.equal((await f.request(path, { method: 'POST', cookie, raw: '{}', contentType: 'text/plain' })).status, 415);
  }
  const change = (revision, target, reason) => f.request('/api/staff/orders/1', { method: 'POST', cookie, body: { revision, target, reason } });
  assert.equal((await change(1, 'Ready')).status, 422);
  assert.equal((await change(1, 'Cancelled', '  ')).status, 422);
  assert.equal(f.store.readOrder(1).history.length, 0);
  assert.equal((await change(1, 'Preparing')).status, 200);
  assert.equal((await change(2, 'Ready')).status, 200);
  assert.equal((await change(3, 'Collected')).status, 200);
  assert.equal((await change(4, 'Cancelled', 'Unavailable')).status, 422);
  assert.equal((await f.request('/api/staff/orders?filter=Active', { cookie })).data.orders.length, 0);
  for (const filter of ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled', 'All']) assert.equal((await f.request(`/api/staff/orders?filter=${filter}`, { cookie })).status, 200);
  assert.equal(f.count(), 1);
  assert.equal(f.store.readOrder(1).history.length, 3);
  assert.equal((await f.request('/api/logout', { method: 'POST', cookie, body: {} })).status, 200);
  assert.equal((await f.request('/api/staff/orders', { cookie })).status, 401);
});

test('C1/C3: private public projection, all guidance, terminal links remain valid', async t => {
  const f = await isolated(t);
  const first = await f.place();
  assert.ok(Buffer.from(first.data.privateKey, 'base64url').length >= 16);
  const read = async () => (await f.request(`/api/tracking/${first.data.privateKey}`)).data.order;
  assert.match((await read()).guidance, /not ready/);
  for (const key of ['history', 'employee', 'privateKey', 'revision']) assert.equal(key in await read(), false);
  const cookie = (await f.login()).cookie;
  const change = (revision, target, reason) => f.request('/api/staff/orders/1', { method: 'POST', cookie, body: { revision, target, reason } });
  await change(1, 'Preparing'); assert.match((await read()).guidance, /not ready/);
  await change(2, 'Ready'); assert.match((await read()).guidance, /Show your order number and pay at collection/);
  await change(3, 'Cancelled', 'Kitchen equipment unavailable');
  assert.match((await read()).guidance, /Kitchen equipment unavailable.*Demo contact — not monitored/);
  assert.equal((await change(4, 'Preparing')).status, 422);
  for (const key of ['1', token(), '']) {
    const denied = await f.request(`/api/tracking/${key}`);
    assert.equal(denied.status, 404);
    assert.equal('order' in denied.data, false);
  }
});

test('Q-SUBMISSION: 100 valid/repeated/lost-response/rejected cases have exact order counts', async t => {
  const f = await isolated(t);
  for (let index = 0; index < 100; index++) {
    const context = token(), attempt = token();
    const rejected = index % 4 === 3;
    const chosen = rejected ? [] : selection;
    const expectedCount = Math.floor(index / 4) * 3 + Math.min(index % 4 + 1, 3);
    const [a, b] = await Promise.all([f.place(chosen, context, attempt), f.place(chosen, context, attempt)]);
    const recovered = await f.request('/api/attempts/check', { method: 'POST', context, body: { attempt } });
    assert.equal(a.data.outcome, rejected ? 'rejected' : 'accepted');
    assert.deepEqual(b.data, a.data);
    assert.deepEqual(recovered.data, a.data);
    assert.equal(f.count(), expectedCount, `case ${index + 1}`);
  }
  assert.equal(f.count(), 75);
});

test('Q-CONSISTENCY: 100 competing valid pairs, one success/one conflict and deliberate recovery', async t => {
  const f = await isolated(t);
  const luis = (await f.login()).cookie, elena = (await f.login('elena')).cookie;
  for (let index = 0; index < 100; index++) {
    const placed = await f.place();
    const number = placed.data.order.number;
    const change = (cookie, revision, target, reason = '') => f.request(`/api/staff/orders/${number}`, { method: 'POST', cookie, body: { revision, target, reason } });
    const pair = await Promise.all([change(luis, 1, 'Preparing'), change(elena, 1, 'Cancelled', 'Cannot fulfill')]);
    assert.deepEqual(pair.map(result => result.status).sort(), [200, 409]);
    assert.match(pair.find(result => result.status === 409).data.message, /changed.*Review/);
    const current = f.store.readOrder(number);
    assert.equal(current.revision, 2);
    assert.equal(current.history.length, 1);
    if (current.status === 'Preparing') assert.equal((await change(elena, 2, 'Ready')).status, 200);
    else assert.equal((await change(luis, 2, 'Preparing')).status, 422);
  }
  assert.equal(f.count(), 100);
});
