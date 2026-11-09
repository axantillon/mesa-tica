import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startApp, freshDataDir, removeDataDir, OPEN_NOON, costaRica } from './harness.js';
import { runSetup } from '../src/setup.js';
import { openStores } from '../src/store.js';

const id = () => randomBytes(18).toString('base64url');
const CART = [{ itemId: 'M1', quantity: 2, reviewedPrice: 4500 }, { itemId: 'D1', quantity: 1, reviewedPrice: 1300 }];
const ALL_DAY = Array(7).fill({ open: 0, close: 1440 });

let app;
before(async () => { app = await startApp(); });
after(() => app.stop());

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function request(path, init = {}, base = app.base) {
  const response = await fetch(base + path, init);
  return { status: response.status, data: await response.json(), headers: response.headers };
}

async function signIn(name, target = app) {
  const { status, headers } = await request('/api/staff/signin', json({ username: name, password: target.credentials[name] }), target.base);
  assert.equal(status, 200);
  return headers.get('set-cookie').split(';')[0];
}

const placeOrder = async (base = app.base, cart = CART) => (await request('/api/orders', json({ context: id(), attempt: id(), selection: cart }), base)).data;
const asStaff = (cookie, init = {}) => ({ ...init, headers: { ...init.headers, cookie } });
const getDetail = async (cookie, number) => (await request(`/api/staff/orders/${number}`, asStaff(cookie))).data;
const change = (cookie, number, revision, target, reason, base = app.base) => request(`/api/staff/orders/${number}/status`, asStaff(cookie, json({ revision, target, reason })), base);
const list = async (cookie, filter) => (await request(`/api/staff/orders?filter=${filter}`, asStaff(cookie))).data.orders;

test('B1 sign-in failure is generic for wrong passwords and unknown accounts alike', async () => {
  const fresh = await startApp();
  try {
    const wrong = await request('/api/staff/signin', json({ username: 'luis', password: 'nope' }), fresh.base);
    const unknown = await request('/api/staff/signin', json({ username: 'nobody', password: 'nope' }), fresh.base);
    assert.equal(wrong.status, 401);
    assert.deepEqual([unknown.status, unknown.data], [wrong.status, wrong.data]);
  } finally {
    await fresh.stop();
  }
});

test('B1 excessive failed sign-ins are limited without revealing whether the account exists', async () => {
  const fresh = await startApp();
  try {
    for (const username of ['luis', 'ghost']) {
      for (let i = 0; i < 5; i++) {
        assert.equal((await request('/api/staff/signin', json({ username, password: 'bad' }), fresh.base)).status, 401);
      }
      assert.equal((await request('/api/staff/signin', json({ username, password: 'bad' }), fresh.base)).status, 429);
    }
    fresh.clock.t += 16 * 60 * 1000;
    assert.equal((await request('/api/staff/signin', json({ username: 'luis', password: fresh.credentials.luis }), fresh.base)).status, 200);
  } finally {
    await fresh.stop();
  }
});

test('B1 session expiry and sign-out both remove access to orders', async () => {
  const fresh = await startApp();
  try {
    const cookie = await signIn('luis', fresh);
    const orders = '/api/staff/orders?filter=Active';
    assert.equal((await request(orders, asStaff(cookie), fresh.base)).status, 200);
    fresh.clock.t += 13 * 60 * 60 * 1000;
    assert.equal((await request(orders, asStaff(cookie), fresh.base)).status, 401);
    fresh.clock.t = OPEN_NOON;
    const second = await signIn('elena', fresh);
    assert.equal((await request('/api/staff/signout', asStaff(second, json({})), fresh.base)).status, 200);
    assert.equal((await request(orders, asStaff(second), fresh.base)).status, 401);
  } finally {
    await fresh.stop();
  }
});

test('ACCESS a deauthorized employee loses access immediately', async () => {
  const fresh = await startApp();
  try {
    const cookie = await signIn('elena', fresh);
    fresh.db.prepare("UPDATE employees SET authorized = 0 WHERE username = 'elena'").run();
    assert.equal((await request('/api/staff/orders', asStaff(cookie), fresh.base)).status, 401);
    assert.equal((await request('/api/staff/signin', json({ username: 'elena', password: fresh.credentials.elena }), fresh.base)).status, 401);
  } finally {
    await fresh.stop();
  }
});

test('ACCESS every staff read and write refuses unauthenticated callers and a tracking token grants nothing', async () => {
  const order = await placeOrder();
  const token = order.trackingPath.split('/').pop();
  for (const headers of [{}, { cookie: 'mesa_staff=forged' }, { cookie: `mesa_staff=${token}` }, { authorization: `Bearer ${token}` }]) {
    for (const [path, init] of [
      ['/api/staff/session', {}],
      ['/api/staff/orders?filter=All', {}],
      [`/api/staff/orders/${order.number}`, {}],
      [`/api/staff/orders/${order.number}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1, target: 'Preparing' }) }],
    ]) {
      const result = await request(path, { ...init, headers: { ...init.headers, ...headers } });
      assert.deepEqual([result.status, result.data], [401, { outcome: 'sign_in_required' }], path);
    }
  }
  const detail = await getDetail(await signIn('luis'), order.number);
  assert.equal(detail.status, 'Received');
});

test('B1 filters, oldest-first order and stable tie-break', async () => {
  const fresh = await startApp();
  try {
    const cookie = await signIn('luis', fresh);
    const details = (filter) => request(`/api/staff/orders?filter=${filter}`, asStaff(cookie), fresh.base).then((r) => r.data.orders.map((o) => o.number));
    assert.deepEqual(await details('Active'), []);
    const a = await placeOrder(fresh.base); // same instant as b: the number breaks the tie
    const b = await placeOrder(fresh.base);
    fresh.clock.t += 60_000;
    const c = await placeOrder(fresh.base);
    assert.deepEqual(await details('Active'), [a.number, b.number, c.number]);
    await change(cookie, a.number, 1, 'Cancelled', 'Out of rice', fresh.base);
    await change(cookie, b.number, 1, 'Preparing', undefined, fresh.base);
    assert.deepEqual(await details('Active'), [b.number, c.number]);
    assert.deepEqual(await details('Cancelled'), [a.number]);
    assert.deepEqual(await details('Preparing'), [b.number]);
    assert.deepEqual(await details('Received'), [c.number]);
    assert.deepEqual(await details('Ready'), []);
    assert.deepEqual(await details('Collected'), []);
    assert.deepEqual(await details('All'), [a.number, b.number, c.number]);
    assert.equal((await request('/api/staff/orders?filter=Nope', asStaff(cookie), fresh.base)).status, 400);
    assert.equal((await request('/api/staff/orders?filter=__proto__', asStaff(cookie), fresh.base)).status, 400);
  } finally {
    await fresh.stop();
  }
});

test('B2 accepted names, prices and totals stay fixed after the menu changes', async () => {
  const fresh = await startApp();
  try {
    const cookie = await signIn('luis', fresh);
    const order = await placeOrder(fresh.base);
    fresh.db.prepare("UPDATE menu_items SET price = 9999, name = 'Renamed'").run();
    fresh.db.prepare("DELETE FROM menu_items WHERE id = 'D1'").run();
    const detail = (await request(`/api/staff/orders/${order.number}`, asStaff(cookie), fresh.base)).data;
    assert.deepEqual(detail.items, [
      { name: 'Chicken casado', price: 4500, quantity: 2, subtotal: 9000 },
      { name: 'Horchata', price: 1300, quantity: 1, subtotal: 1300 },
    ]);
    assert.equal(detail.total, 10300);
    assert.equal(detail.submitted, 'Mon, Nov 9, 12:00 PM');
    assert.deepEqual(detail.history, []);
    assert.equal(detail.token, undefined);
  } finally {
    await fresh.stop();
  }
});

test('B3 only listed transitions succeed, with employee and time recorded; final states cannot change', async () => {
  const luis = await signIn('luis');
  const elena = await signIn('elena');
  const order = await placeOrder();
  const { number } = order;

  const illegal = await change(luis, number, 1, 'Ready');
  assert.deepEqual([illegal.status, illegal.data.outcome], [422, 'invalid']);
  assert.equal((await change(luis, number, 1, 'Collected')).status, 422);
  assert.equal((await change(luis, number, 1, 'Nonsense')).status, 422);

  assert.equal((await change(luis, number, 1, 'Preparing')).data.order.status, 'Preparing');
  assert.equal((await change(elena, number, 2, 'Ready')).data.order.status, 'Ready');
  const collected = (await change(luis, number, 3, 'Collected')).data.order;
  assert.equal(collected.status, 'Collected');
  assert.deepEqual(collected.allowedActions, []);
  assert.deepEqual(collected.history.map((h) => [h.fromStatus, h.toStatus, h.employee]), [
    ['Received', 'Preparing', 'Luis'], ['Preparing', 'Ready', 'Elena'], ['Ready', 'Collected', 'Luis'],
  ]);
  assert.ok(collected.history.every((h) => h.time === 'Mon, Nov 9, 12:00 PM'));

  for (const target of ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled']) {
    assert.equal((await change(luis, number, 4, target, 'Too late')).status, 422, target);
  }

  const toCancel = await placeOrder();
  const blank = await change(luis, toCancel.number, 1, 'Cancelled', '   ');
  assert.deepEqual([blank.status, blank.data.message], [422, 'Enter the reason the customer will see.']);
  assert.equal((await change(luis, toCancel.number, 1, 'Cancelled')).status, 422);
  const cancelled = (await change(luis, toCancel.number, 1, 'Cancelled', '  Kitchen closed early  ')).data.order;
  assert.equal(cancelled.cancellationReason, 'Kitchen closed early');
  assert.equal(cancelled.history[0].reason, 'Kitchen closed early');
  assert.equal((await change(luis, toCancel.number, 2, 'Preparing')).status, 422);
});

test('B3 staff may finish accepted orders after closing', async () => {
  const fresh = await startApp();
  try {
    const cookie = await signIn('luis', fresh);
    const order = await placeOrder(fresh.base);
    fresh.clock.t = costaRica(9, 22);
    assert.equal((await change(cookie, order.number, 1, 'Preparing', undefined, fresh.base)).status, 200);
  } finally {
    await fresh.stop();
  }
});

test('B3-CONFLICT competing changes yield one success and one explained conflict, 100 pairs', async () => {
  const luis = await signIn('luis');
  const elena = await signIn('elena');
  for (let round = 0; round < 100; round++) {
    const { number } = await placeOrder();
    const [first, second] = await Promise.all([
      change(luis, number, 1, 'Preparing'),
      change(elena, number, 1, 'Cancelled', 'Out of plantain'),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const conflict = first.status === 409 ? first : second;
    const winner = first.status === 200 ? first : second;
    assert.equal(conflict.data.outcome, 'conflict');
    assert.equal(conflict.data.order.status, winner.data.order.status);
    assert.equal(conflict.data.order.revision, 2);
    const detail = await getDetail(luis, number);
    assert.equal(detail.history.length, 1);
    if (winner.data.order.status === 'Preparing') {
      assert.equal((await change(elena, number, 2, 'Ready')).status, 200, 'deliberate new attempt against current state');
    }
  }
});

test('B3-CONFLICT a stale revision does not overwrite newer work', async () => {
  const luis = await signIn('luis');
  const elena = await signIn('elena');
  const { number } = await placeOrder();
  await change(luis, number, 1, 'Preparing');
  await change(elena, number, 2, 'Ready');
  const stale = await change(luis, number, 2, 'Cancelled', 'Oops');
  assert.deepEqual([stale.status, stale.data.order.status], [409, 'Ready']);
  assert.equal((await getDetail(luis, number)).cancellationReason, null);
  assert.equal((await change(luis, number, 99, 'Collected')).status, 409);
  assert.equal((await request('/api/staff/orders/999999/status', asStaff(luis, json({ revision: 1, target: 'Ready' })))).status, 404);
  assert.equal((await request('/api/staff/orders/1001/status', asStaff(luis, json({ revision: 'x', target: 'Ready' })))).status, 400);
});

test('C1 a private link opens only its order; invalid links and guessed numbers disclose nothing', async () => {
  const luis = await signIn('luis');
  const mine = await placeOrder();
  const other = await placeOrder(undefined, [{ itemId: 'D2', quantity: 3, reviewedPrice: 1000 }]);
  await change(luis, mine.number, 1, 'Preparing');
  const snapshot = (await request(`/api/${mine.trackingPath.slice(1)}`)).data;
  assert.equal(snapshot.number, mine.number);
  assert.equal(snapshot.status, 'Preparing');
  assert.notEqual(snapshot.number, other.number);
  assert.deepEqual(snapshot.items.map((i) => i.name), ['Chicken casado', 'Horchata']);
  assert.ok(!/Luis|Elena|history|revision|employee/i.test(JSON.stringify(snapshot)), 'no staff identity or internals');

  const unavailable = { status: 404, data: { outcome: 'link_unavailable' } };
  for (const guess of [String(mine.number), `%23${mine.number}`, 'not-a-token', '', randomBytes(32).toString('base64url')]) {
    const result = await request(`/api/track/${guess}`);
    assert.deepEqual({ status: result.status, data: result.data }, unavailable, guess);
  }
});

test('C3 guidance matches each status; Cancelled shows the exact reason and labeled contact', async () => {
  const luis = await signIn('luis');
  const order = await placeOrder();
  const snapshot = async () => (await request(`/api/${order.trackingPath.slice(1)}`)).data;
  assert.match((await snapshot()).guidance.message, /not ready for pickup yet/);
  assert.equal((await snapshot()).guidance.pickup, undefined);
  await change(luis, order.number, 1, 'Preparing');
  assert.match((await snapshot()).guidance.message, /not ready for pickup yet/);
  await change(luis, order.number, 2, 'Ready');
  const ready = await snapshot();
  assert.equal(ready.guidance.message, 'Your order is ready for pickup.');
  assert.deepEqual(ready.guidance.pickup, {
    instructions: 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.',
    location: 'Mesa Tica pickup counter',
    payment: 'Pay at collection.',
  });
  await change(luis, order.number, 3, 'Collected');
  const collected = await snapshot();
  assert.equal(collected.guidance.message, 'This order has been collected.');
  assert.equal(collected.guidance.pickup, undefined);

  const toCancel = await placeOrder();
  await change(luis, toCancel.number, 1, 'Cancelled', 'Out of chicken today');
  const cancelled = (await request(`/api/${toCancel.trackingPath.slice(1)}`)).data;
  assert.deepEqual(cancelled.guidance.cancellation, {
    reason: 'Out of chicken today',
    contact: 'demo-contact@example.invalid',
    contactLabel: 'Demo contact — not monitored.',
  });
});

test('SETUP orders, status, history, sessions and private links survive a restart', async () => {
  const dataDir = freshDataDir();
  const first = await startApp({ dataDir });
  const cookie = await signIn('luis', first);
  const order = await placeOrder(first.base);
  await change(cookie, order.number, 1, 'Preparing', undefined, first.base);
  await first.shutdown();

  const second = await startApp({ dataDir });
  try {
    const detail = (await request(`/api/staff/orders/${order.number}`, asStaff(cookie), second.base)).data;
    assert.equal(detail.status, 'Preparing');
    assert.equal(detail.history[0].employee, 'Luis');
    const snapshot = (await request(`/api/${order.trackingPath.slice(1)}`, {}, second.base)).data;
    assert.equal(snapshot.status, 'Preparing');
    assert.equal(second.db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n, 9);
  } finally {
    await second.stop();
  }
});

test('A4/B3 guarantees hold across two server processes sharing the database', { timeout: 60_000 }, async () => {
  const dataDir = freshDataDir();
  runSetup(dataDir);
  const stores = openStores(dataDir);
  const restaurant = JSON.parse(stores.db.prepare('SELECT data FROM restaurant').get().data);
  stores.db.prepare('UPDATE restaurant SET data = ?').run(JSON.stringify({ ...restaurant, openingHours: ALL_DAY }));
  stores.close();

  const startProcess = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.js'], {
      env: { ...process.env, MESA_DATA_DIR: dataDir, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.once('data', (chunk) => resolve({ child, base: /http:\/\/[\d.:]+/.exec(String(chunk))[0] }));
    child.once('error', reject);
  });
  const one = await startProcess();
  const two = await startProcess();
  const credentials = (await import('./harness.js')).readCredentials(dataDir);
  try {
    let seen = 0;
    for (let round = 0; round < 50; round++) {
      const context = id();
      const attempt = id();
      const results = await Promise.all([one, two, one, two].map(({ base }) => request('/api/orders', json({ context, attempt, selection: CART }), base)));
      assert.equal(new Set(results.map((r) => r.data.number)).size, 1);
      seen += 1;
    }
    const verify = openStores(dataDir);
    assert.equal(verify.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, seen);
    verify.close();

    const cookieOne = await signIn('luis', { base: one.base, credentials });
    const cookieTwo = await signIn('elena', { base: two.base, credentials });
    for (let round = 0; round < 50; round++) {
      const { number } = await placeOrder(one.base);
      const statuses = (await Promise.all([
        change(cookieOne, number, 1, 'Preparing', undefined, one.base),
        change(cookieTwo, number, 1, 'Preparing', undefined, two.base),
      ])).map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 409]);
    }
  } finally {
    one.child.kill();
    two.child.kill();
    removeDataDir(dataDir);
  }
});
