import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { application } from '../src/server.js';
import { setup } from '../src/setup.js';
import { openDatabase } from '../src/store.js';
import { token } from '../src/orders.js';

test('HTTP staff access, audited lifecycle, privacy and restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mesa-staff-'));
  const credentialsPath = setup(directory);
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  assert.equal(statSync(credentialsPath).mode & 0o777, 0o600);
  assert.notEqual(credentials.luis, credentials.elena);
  const db = openDatabase(directory);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  let clock = '2026-11-05T21:00:00Z';
  let server;
  let origin;
  async function start() {
    server = application({ directory, now: () => new Date(clock) });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
  }
  const stop = () => new Promise((resolve) => server.close(resolve));
  await start();
  t.after(async () => {
    await stop();
    db.close();
    rmSync(directory, { recursive: true });
  });

  const api = async (path, { body, cookie, headers = {} } = {}) => {
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(origin + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { code: response.status, cookie: response.headers.get('set-cookie'), data: await response.json() };
  };
  const staff = (path, options) => api('staff/' + path, options);
  const login = (username, password) => staff('sign-in', { body: { username, password } });
  const orderPath = (number) => 'orders/' + number;
  const orderRequest = (number, cookie, body) => staff(orderPath(number), { cookie, body });
  const create = (price = 4500) => api('checkout/submit', { body: {
    customer: token(), attempt: token(), selection: [{ code: 'M1', quantity: 2, price }],
  } });
  const track = (result) => api(result.data.trackingPath.slice(1));

  assert.equal((await staff('orders')).code, 401);
  assert.equal((await staff('orders/1')).code, 401);
  assert.equal((await staff('orders/1', { body: { revision: 0, target: 'Ready' } })).code, 401);
  assert.deepEqual((await login('luis', 'incorrect')).data, (await login('missing', 'incorrect')).data);
  const luisSession = await login('luis', credentials.luis);
  assert.match(luisSession.cookie, /HttpOnly; SameSite=Strict/);
  assert.equal(luisSession.data.name, 'Luis');
  const luis = luisSession.cookie.split(';')[0];
  const elenaSession = await login('elena', credentials.elena);
  assert.equal(elenaSession.data.name, 'Elena');
  const elena = elenaSession.cookie.split(';')[0];

  assert.deepEqual((await staff('orders', { cookie: luis })).data.orders, []);
  const first = await create();
  const second = await create();
  const third = await create();
  const ids = [first, second, third].map((item) => item.data.order.number);
  const [a, b, c] = ids;
  assert.deepEqual((await staff('orders', { cookie: luis })).data.orders.map((order) => order.number), ids);
  const filtered = async (filter) => (await staff('orders?filter=' + filter, { cookie: luis })).data.orders.map((order) => order.number);
  assert.deepEqual(await filtered('Received'), ids);
  assert.deepEqual(await filtered('Ready'), []);
  assert.equal((await orderRequest(a, first.data.trackingPath.split('/').at(-1))).code, 401);
  assert.equal((await staff(orderPath(a), {
    cookie: luis, body: { revision: 0, target: 'Preparing' }, headers: { 'Sec-Fetch-Site': 'same-site' },
  })).code, 403);

  db.exec("UPDATE menu SET name = 'Updated menu name', price = 4700 WHERE code = 'M1'");
  const detail = await orderRequest(a, luis);
  assert.deepEqual(detail.data.order.items, [{ code: 'M1', name: 'Chicken casado', quantity: 2, price: 4500, subtotal: 9000 }]);
  assert.equal(detail.data.order.total, 9000);
  assert.equal(detail.data.order.submittedAt, clock.replace('Z', '.000Z'));
  assert.equal((await orderRequest(a, luis, { revision: 0, target: 'Ready' })).code, 422);
  assert.equal((await orderRequest(a, luis, { revision: 0, target: 'Cancelled', reason: '  ', confirmed: true })).code, 422);
  assert.equal((await orderRequest(a, luis, { revision: 0, target: 'Cancelled', reason: 'No ingredients' })).code, 422);
  assert.equal((await orderRequest(a, luis)).data.history.length, 0);

  const reason = 'Kitchen closed early.\nNo more meals.';
  const [winner, loser] = await Promise.all([
    orderRequest(a, luis, { revision: 0, target: 'Preparing' }),
    orderRequest(a, elena, { revision: 0, target: 'Cancelled', confirmed: true, reason }),
  ]).then((results) => results.sort((left, right) => left.code - right.code));
  assert.equal(winner.code, 200);
  assert.equal(loser.code, 409);
  assert.deepEqual(loser.data.history, winner.data.history);
  assert.equal(winner.data.history.length, 1);
  assert.ok(['Luis', 'Elena'].includes(winner.data.history[0].employee));

  clock = '2026-11-06T03:00:01Z';
  assert.equal((await orderRequest(b, luis, { revision: 0, target: 'Preparing' })).code, 200);
  assert.equal((await track(second)).data.order.status, 'Preparing');
  assert.deepEqual(await filtered('Preparing'), winner.data.order.status === 'Preparing' ? [a, b] : [b]);
  assert.equal((await orderRequest(b, luis, { revision: 1, target: 'Ready' })).code, 200);
  assert.deepEqual(await filtered('Ready'), [b]);
  const ready = (await track(second)).data;
  assert.equal(ready.order.status, 'Ready');
  assert.equal(ready.guidance.pickupLocation, 'Mesa Tica pickup counter');
  assert.equal((await orderRequest(b, elena, { revision: 2, target: 'Collected' })).code, 200);
  assert.equal((await orderRequest(b, luis, { revision: 3, target: 'Preparing' })).code, 422);
  assert.deepEqual((await track(second)).data.guidance, {});

  assert.equal((await orderRequest(c, elena, { revision: 0, target: 'Cancelled', reason, confirmed: true })).code, 200);
  const cancelled = (await track(third)).data;
  assert.equal(cancelled.order.reason, reason);
  assert.equal(cancelled.guidance.contactLabel, 'Demo contact — not monitored');
  assert.doesNotMatch(JSON.stringify(cancelled), /Elena|history|revision|employee/i);
  assert.equal((await orderRequest(c, luis, { revision: 1, target: 'Preparing' })).code, 422);
  assert.deepEqual((await staff('orders?filter=Collected', { cookie: luis })).data.orders.map((order) => order.number), [b]);
  assert.deepEqual((await staff('orders?filter=All', { cookie: luis })).data.orders.map((order) => order.number), ids);
  const active = (await staff('orders', { cookie: luis })).data.orders;
  assert.deepEqual(active.map((order) => order.number), winner.data.order.status === 'Preparing' ? [a] : []);
  const expectedCancelled = winner.data.order.status === 'Cancelled' ? [a, c] : [c];
  assert.deepEqual((await staff('orders?filter=Cancelled', { cookie: luis })).data.orders.map((order) => order.number), expectedCancelled);

  await stop();
  setup(directory);
  assert.deepEqual(JSON.parse(readFileSync(credentialsPath, 'utf8')), credentials);
  assert.equal(db.prepare("SELECT name FROM menu WHERE code = 'M1'").get().name, 'Updated menu name');
  await start();
  const restored = await orderRequest(b, luis);
  assert.deepEqual(restored.data.history.map((change) => change.employee), ['Luis', 'Luis', 'Elena']);
  assert.equal(restored.data.order.status, 'Collected');
  assert.deepEqual((await track(third)).data, cancelled);
  assert.equal((await staff('sign-out', { cookie: elena, body: {} })).code, 200);
  assert.equal((await staff('orders', { cookie: elena })).code, 401);
  clock = '2026-11-06T03:00:02Z';
  // Use a fresh session first to prove expiry independently of logout.
  const fresh = (await login('elena', credentials.elena)).cookie.split(';')[0];
  assert.equal((await staff('orders', { cookie: fresh })).code, 200);
  clock = '2026-11-06T11:00:02Z';
  assert.equal((await staff('orders', { cookie: fresh })).code, 401);
});
