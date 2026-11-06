import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startApp, PASSWORDS } from './helpers.js';
import { Poller, finalError } from '../shared/Poller.js';

const numbers = (res) => res.body.orders.map((o) => o.number);

test('B1 view queue', async (t) => {
  const app = await startApp(t);
  const order = (await app.place()).body;

  await t.test('every staff route without a valid session: 401, no data', async () => {
    const routes = [
      ['GET', '/api/staff/orders'],
      ['GET', '/api/staff/orders?status=Received,Collected'],
      ['GET', `/api/staff/orders/${order.number}`],
      ['POST', `/api/staff/orders/${order.number}/status`, { version: 1, to: 'Preparing' }],
    ];
    for (const [method, path, body] of routes) {
      for (const cookie of [undefined, 'mesa_session=not-a-session', 'mesa_session=']) {
        const res = await app.call(method, path, body, cookie ? { Cookie: cookie } : {});
        assert.equal(res.status, 401, `${method} ${path} ${cookie}`);
        assert.deepEqual(res.body, { reason: 'not_signed_in' });
      }
    }
    assert.equal(app.rows('SELECT COUNT(*) AS n FROM StatusChange')[0].n, 0);
  });

  await t.test('wrong password or unknown user refused, no cookie', async () => {
    for (const body of [
      { username: 'luis', password: 'wrong' },
      { username: 'luis', password: PASSWORDS.STAFF_PASSWORD_ELENA },
      { username: 'nobody', password: PASSWORDS.STAFF_PASSWORD_LUIS },
      { username: 'luis' },
      {},
    ]) {
      const res = await app.call('POST', '/api/staff/sign-in', body);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { reason: 'bad_credentials' });
      assert.equal(res.headers.get('set-cookie'), null);
    }
  });

  await t.test('sign in sets an HttpOnly session cookie, Secure behind HTTPS', async () => {
    const plain = await app.call('POST', '/api/staff/sign-in', { username: 'luis', password: PASSWORDS.STAFF_PASSWORD_LUIS });
    assert.equal(plain.status, 200);
    assert.deepEqual(plain.body, { name: 'Luis' });
    assert.match(plain.headers.get('set-cookie'), /^mesa_session=[\w-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=43200$/);
    const https = await app.call('POST', '/api/staff/sign-in', { username: 'elena', password: PASSWORDS.STAFF_PASSWORD_ELENA }, { 'X-Forwarded-Proto': 'https' });
    assert.match(https.headers.get('set-cookie'), /; Secure$/);
  });

  await t.test('oldest first; each filter; default Received, Preparing, Ready', async () => {
    const luis = await app.signIn('luis');
    app.clock.now = new Date('2026-11-06T18:30:00Z');
    const late = (await app.place()).body; // placed later in time...
    app.clock.now = new Date('2026-11-06T17:00:00Z');
    const early = (await app.place()).body; // ...than this one, which has a higher number
    const tie = (await app.place()).body; // same submittedAt as `early`: number decides
    app.clock.now = new Date('2026-11-06T18:00:00Z');
    const [preparing, ready, collected, cancelled] = [(await app.place()).body, (await app.place()).body, (await app.place()).body, (await app.place()).body];
    const moves = [[preparing, ['Preparing']], [ready, ['Preparing', 'Ready']], [collected, ['Preparing', 'Ready', 'Collected']], [cancelled, ['Cancelled']]];
    for (const [o, steps] of moves) {
      let version = 1;
      for (const to of steps) assert.equal((await app.changeStatus(luis, o.number, version++, to, 'Out of stock')).status, 200);
    }
    const list = (q = '') => app.call('GET', `/api/staff/orders${q}`, undefined, luis);
    const all = await list('?status=Received,Preparing,Ready,Collected,Cancelled');
    assert.deepEqual(numbers(all), [early.number, tie.number, order.number, preparing.number, ready.number, collected.number, cancelled.number, late.number]);
    assert.deepEqual(numbers(await list()), [early.number, tie.number, order.number, preparing.number, ready.number, late.number]);
    assert.deepEqual(numbers(await list('?status=')), numbers(await list()));
    assert.deepEqual(numbers(await list('?status=Received')), [early.number, tie.number, order.number, late.number]);
    assert.deepEqual(numbers(await list('?status=Preparing')), [preparing.number]);
    assert.deepEqual(numbers(await list('?status=Ready')), [ready.number]);
    assert.deepEqual(numbers(await list('?status=Collected')), [collected.number]);
    assert.deepEqual(numbers(await list('?status=Cancelled')), [cancelled.number]);
    assert.deepEqual(numbers(await list('?status=Collected,Cancelled')), [collected.number, cancelled.number]);
    assert.deepEqual((await list('?status=Done')).body, { reason: 'bad_filter' });
    const first = all.body.orders[0];
    assert.deepEqual(Object.keys(first).sort(), ['lines', 'number', 'status', 'submittedAt', 'total', 'version']);
  });

  await t.test('a session ends after 12 hours', async () => {
    const luis = await app.signIn('luis');
    assert.equal((await app.call('GET', '/api/staff/orders', undefined, luis)).status, 200);
    app.clock.now = new Date(app.clock.now.getTime() + 12 * 3600_000);
    assert.equal((await app.call('GET', '/api/staff/orders', undefined, luis)).status, 401);
  });

  await t.test('polling state: a failure keeps the queue and warns; a success clears it', async () => {
    let offline = false;
    let queue = ['#1'];
    const poller = new Poller(async () => {
      if (offline) throw new Error('offline');
      return queue;
    }, { timeout: 50 });
    await poller.tick();
    assert.deepEqual([poller.data, poller.warning], [['#1'], false]);
    const firstSuccess = poller.lastSuccess;
    offline = true;
    queue = ['#1', '#2'];
    await poller.tick();
    assert.deepEqual([poller.data, poller.warning, poller.lastSuccess], [['#1'], true, firstSuccess]);
    offline = false;
    await poller.tick();
    assert.deepEqual([poller.data, poller.warning], [['#1', '#2'], false]);
  });

  await t.test('polling: over 5 s is a failure, a 401 stops it, the next poll starts 2 s after the last ends', async () => {
    const slow = new Poller(() => sleep(200, 'late'), { timeout: 20 });
    await slow.tick();
    assert.deepEqual([slow.data, slow.warning], [null, true]);
    assert.equal(new Poller(() => {}).timeout, 5000);
    assert.equal(new Poller(() => {}).interval, 2000);

    const signedOut = new Poller(async () => {
      throw finalError(401);
    });
    await signedOut.start(() => {});
    assert.equal(signedOut.stopped, true);
    assert.equal(signedOut.stopReason.status, 401);

    const calls = [];
    const paced = new Poller(async () => {
      const call = { start: Date.now() };
      calls.push(call);
      await sleep(30);
      call.end = Date.now();
      if (calls.length === 3) paced.stop();
    }, { interval: 60 });
    await paced.start(() => {});
    assert.equal(calls.length, 3);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i].start - calls[i - 1].end >= 55, 'waits after the previous poll ends');
  });

  await t.test('polling against the server: a staff page poller fetches the queue with its filter', async () => {
    const luis = await app.signIn('luis');
    const poller = new Poller(async () => {
      const res = await app.call('GET', '/api/staff/orders?status=Cancelled', undefined, luis);
      if (res.status === 401) throw finalError(401);
      return res.body.orders;
    });
    await poller.tick();
    assert.equal(poller.data.length, 1);
    const anonymous = new Poller(async () => {
      const res = await app.call('GET', '/api/staff/orders');
      if (res.status === 401) throw finalError(401);
      return res.body.orders;
    });
    await anonymous.tick();
    assert.deepEqual([anonymous.stopped, anonymous.data], [true, null]);
  });
});

test('B2 inspect order', async (t) => {
  const app = await startApp(t);
  const luis = await app.signIn('luis');
  const placed = (await app.place([{ code: 'M1', price: 4500, quantity: 1 }, { code: 'D1', price: 1300, quantity: 2 }])).body;
  const expected = {
    number: placed.number,
    submittedAt: '2026-11-06T18:00:00.000Z',
    status: 'Received',
    version: 1,
    total: 7100,
    cancellationReason: null,
    lines: [
      { dishName: 'Chicken casado', price: 4500, quantity: 1 },
      { dishName: 'Horchata', price: 1300, quantity: 2 },
    ],
    statusChanges: [],
  };

  await t.test('number, lines, quantities, submittedAt, status and version; no token', async () => {
    const res = await app.call('GET', `/api/staff/orders/${placed.number}`, undefined, luis);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.order, expected);
    assert.ok(!res.text.includes(placed.trackingLink.slice(7)));
  });

  await t.test('names and prices kept after a menu change', async () => {
    app.rows("UPDATE Dish SET name = 'Chicken casado XL', price = 9900 WHERE code = 'M1'");
    app.rows("UPDATE Dish SET available = 0 WHERE code = 'D1'");
    const res = await app.call('GET', `/api/staff/orders/${placed.number}`, undefined, luis);
    assert.deepEqual(res.body.order, expected);
    const tracking = await app.call('GET', `/api/track/${placed.trackingLink.slice(7)}`);
    assert.deepEqual(tracking.body.lines, expected.lines);
    assert.equal((await app.call('GET', '/api/menu')).body.dishes[0].price, 9900);
  });

  await t.test('unknown order: 404', async () => {
    for (const n of ['999', 'abc', '1.5', '0']) {
      const res = await app.call('GET', `/api/staff/orders/${n}`, undefined, luis);
      assert.equal(res.status, 404, n);
      assert.deepEqual(res.body, { reason: 'not_found' });
    }
  });
});

test('B3 update status', async (t) => {
  const app = await startApp(t);
  const luis = await app.signIn('luis');
  const elena = await app.signIn('elena');
  const detail = async (n) => (await app.call('GET', `/api/staff/orders/${n}`, undefined, luis)).body.order;

  await t.test('allowed moves work and record employee and time', async () => {
    const o = (await app.place()).body;
    const steps = [['Preparing', luis, 'luis', '18:01'], ['Ready', elena, 'elena', '18:02'], ['Collected', luis, 'luis', '18:03']];
    let version = 1;
    for (const [to, cookie, employeeId, hhmm] of steps) {
      app.clock.now = new Date(`2026-11-06T${hhmm}:00Z`);
      const res = await app.changeStatus(cookie, o.number, version, to);
      assert.equal(res.status, 200);
      assert.equal(res.body.order.status, to);
      assert.equal(res.body.order.version, ++version);
      assert.deepEqual(res.body.order.statusChanges.at(-1), {
        fromStatus: { Preparing: 'Received', Ready: 'Preparing', Collected: 'Ready' }[to],
        toStatus: to, employeeId, changedAt: app.clock.now.toISOString(), reason: null,
      });
    }
    assert.equal(app.rows('SELECT COUNT(*) AS n FROM StatusChange WHERE orderNumber = ?', o.number)[0].n, 3);
  });

  await t.test('cancel with a reason from Received, Preparing or Ready', async () => {
    for (const path of [[], ['Preparing'], ['Preparing', 'Ready']]) {
      const o = (await app.place()).body;
      let version = 1;
      for (const to of path) await app.changeStatus(luis, o.number, version++, to);
      const res = await app.changeStatus(elena, o.number, version, 'Cancelled', '  Out of chicken today.  ');
      assert.equal(res.status, 200);
      assert.equal(res.body.order.status, 'Cancelled');
      assert.equal(res.body.order.cancellationReason, 'Out of chicken today.');
      assert.deepEqual(res.body.order.statusChanges.at(-1).reason, 'Out of chicken today.');
      assert.equal(res.body.order.statusChanges.at(-1).employeeId, 'elena');
    }
  });

  await t.test('skips, backward moves, leaving Collected or Cancelled, cancel without a reason: 422, nothing saved', async () => {
    const make = async (path) => {
      const o = (await app.place()).body;
      let version = 1;
      for (const [to, reason] of path) await app.changeStatus(luis, o.number, version++, to, reason);
      return { number: o.number, version };
    };
    const cases = [
      [[], 'Ready', undefined, 'not_next_status'],
      [[], 'Collected', undefined, 'not_next_status'],
      [[], 'Received', undefined, 'not_next_status'],
      [[['Preparing']], 'Received', undefined, 'not_next_status'],
      [[['Preparing'], ['Ready']], 'Preparing', undefined, 'not_next_status'],
      [[['Preparing'], ['Ready'], ['Collected']], 'Cancelled', 'Too late', 'final_status'],
      [[['Preparing'], ['Ready'], ['Collected']], 'Ready', undefined, 'final_status'],
      [[['Cancelled', 'No fish']], 'Received', undefined, 'final_status'],
      [[['Cancelled', 'No fish']], 'Preparing', undefined, 'final_status'],
      [[], 'Cancelled', undefined, 'reason_required'],
      [[], 'Cancelled', '', 'reason_required'],
      [[['Preparing']], 'Cancelled', '   ', 'reason_required'],
      [[], 'Cancelled', 'x'.repeat(501), 'reason_too_long'],
      [[], 'Done', undefined, 'unknown_status'],
    ];
    for (const [path, to, reason, code] of cases) {
      const { number, version } = await make(path);
      const before = await detail(number);
      const res = await app.changeStatus(luis, number, version, to, reason);
      assert.equal(res.status, 422, `${before.status} → ${to}`);
      assert.equal(res.body.reason, code, `${before.status} → ${to}`);
      assert.deepEqual(await detail(number), before);
    }
  });

  await t.test('same version twice: one 200, one 409 with the current order; nothing overwritten', async () => {
    const o = (await app.place()).body;
    const [a, b] = await Promise.all([
      app.changeStatus(luis, o.number, 1, 'Preparing'),
      app.changeStatus(elena, o.number, 1, 'Cancelled', 'Kitchen closed'),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const [won, lost] = a.status === 200 ? [a, b] : [b, a];
    assert.equal(lost.body.reason, 'stale_version');
    assert.deepEqual(lost.body.order, won.body.order);
    assert.equal(lost.body.order.version, 2);
    assert.equal(app.rows('SELECT COUNT(*) AS n FROM StatusChange WHERE orderNumber = ?', o.number)[0].n, 1);
  });

  await t.test('a retry on the new version works only if still valid', async () => {
    const o = (await app.place()).body;
    assert.equal((await app.changeStatus(elena, o.number, 1, 'Preparing')).status, 200);
    const stale = await app.changeStatus(luis, o.number, 1, 'Preparing');
    assert.equal(stale.status, 409);
    assert.equal(stale.body.order.status, 'Preparing');
    const notValid = await app.changeStatus(luis, o.number, stale.body.order.version, 'Preparing');
    assert.deepEqual([notValid.status, notValid.body.reason], [422, 'not_next_status']);

    const p = (await app.place()).body;
    assert.equal((await app.changeStatus(elena, p.number, 1, 'Preparing')).status, 200);
    const conflict = await app.changeStatus(luis, p.number, 1, 'Cancelled', 'Customer called');
    assert.equal(conflict.status, 409);
    const retry = await app.changeStatus(luis, p.number, conflict.body.order.version, 'Cancelled', 'Customer called');
    assert.equal(retry.status, 200);
    assert.equal(retry.body.order.status, 'Cancelled');
  });

  await t.test('unknown order: 404', async () => {
    assert.equal((await app.changeStatus(luis, 999, 1, 'Preparing')).status, 404);
    assert.equal((await app.changeStatus(luis, 'abc', 1, 'Preparing')).status, 404);
  });
});

test('B3 100 same-version pairs give one success each', async (t) => {
  const app = await startApp(t);
  const luis = await app.signIn('luis');
  const elena = await app.signIn('elena');
  const orders = [];
  for (let i = 0; i < 100; i++) orders.push((await app.place()).body);
  const pairs = [];
  for (let i = 0; i < orders.length; i += 20) {
    // 20 pairs at a time (40 sockets) stays under the OS listen backlog; each pair is sent at once
    pairs.push(...(await Promise.all(
      orders.slice(i, i + 20).map((o) =>
        Promise.all([
          app.changeStatus(luis, o.number, 1, 'Preparing'),
          o.number % 2 ? app.changeStatus(elena, o.number, 1, 'Preparing') : app.changeStatus(elena, o.number, 1, 'Cancelled', 'Out of stock'),
        ]),
      ),
    )));
  }
  assert.equal(pairs.length, 100);
  for (const pair of pairs) assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409]);
  assert.equal(app.rows('SELECT COUNT(*) AS n FROM StatusChange')[0].n, 100);
  assert.equal(app.rows('SELECT COUNT(*) AS n FROM "Order" WHERE version = 2')[0].n, 100);
});
