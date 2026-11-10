import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { TIMES, api, placeOrder, signIn, startTestServer } from '../support/harness.js';

let app;
let luis;
let elena;

before(async () => {
  app = await startTestServer();
  luis = await signIn(app.url, 'luis', app.credentials.luis);
  elena = await signIn(app.url, 'elena', app.credentials.elena);
});
after(() => app.close());

const detail = async (number, cookie = luis) => (await api(app.url, `/api/staff/orders/${number}`, { cookie })).data.order;
const change = (number, body, cookie = luis) => api(app.url, `/api/staff/orders/${number}/status`, { method: 'POST', body, cookie });
const newOrder = async () => (await placeOrder(app.url)).data.confirmation;

describe('B1 staff access and queue', () => {
  test('failed sign-in is generic for unknown accounts and wrong passwords', async () => {
    const unknown = await api(app.url, '/api/staff/session', { method: 'POST', body: { username: 'nobody', password: 'x' } });
    const wrong = await api(app.url, '/api/staff/session', { method: 'POST', body: { username: 'luis', password: 'wrong' } });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.data, wrong.data);
    assert.equal(unknown.data.message, "We couldn't sign you in. Check your credentials and try again.");
    assert.equal(unknown.headers.get('set-cookie'), null);
  });

  test('session cookie is HttpOnly and SameSite=Strict, Secure only when configured', async () => {
    const response = await api(app.url, '/api/staff/session', { method: 'POST', body: { username: 'luis', password: app.credentials.luis } });
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Secure/);
  });

  test('sign-out revokes the session on the server', async () => {
    const cookie = await signIn(app.url, 'elena', app.credentials.elena);
    assert.equal((await api(app.url, '/api/staff/session', { cookie })).status, 200);
    assert.equal((await api(app.url, '/api/staff/session', { method: 'DELETE', cookie })).status, 200);
    assert.equal((await api(app.url, '/api/staff/orders', { cookie })).status, 401);
  });

  test('the default queue is Active, oldest first with a stable number tie-break, and filters work', async () => {
    const orders = [await newOrder(), await newOrder(), await newOrder(), await newOrder()];
    // Same submission instant for two orders: order number breaks the tie.
    app.db.prepare('UPDATE orders SET submitted_at = (SELECT submitted_at FROM orders WHERE number = ?) WHERE number = ?').run(orders[0].orderNumber, orders[1].orderNumber);
    const [first, second, third, fourth] = orders.map((order) => order.orderNumber);
    await change(third, { revision: 1, target: 'Preparing' });
    await change(fourth, { revision: 1, target: 'Cancelled', reason: 'Out of chicken' });

    const active = (await api(app.url, '/api/staff/orders', { cookie: luis })).data;
    assert.equal(active.filter, 'Active');
    const activeNumbers = active.orders.map((order) => order.number);
    assert.deepEqual(activeNumbers.filter((n) => [first, second, third, fourth].includes(n)), [first, second, third]);
    const sorted = [...active.orders].sort((a, b) => a.submittedAt - b.submittedAt || a.number - b.number);
    assert.deepEqual(active.orders.map((o) => o.number), sorted.map((o) => o.number));

    const cancelled = (await api(app.url, '/api/staff/orders?filter=Cancelled', { cookie: luis })).data.orders.map((o) => o.number);
    assert.ok(cancelled.includes(fourth));
    const preparing = (await api(app.url, '/api/staff/orders?filter=Preparing', { cookie: luis })).data.orders;
    assert.ok(preparing.every((order) => order.status === 'Preparing'));
    const all = (await api(app.url, '/api/staff/orders?filter=All', { cookie: luis })).data.orders.map((o) => o.number);
    assert.ok([first, second, third, fourth].every((n) => all.includes(n)));
    for (const filter of ['Received', 'Ready', 'Collected']) {
      assert.equal((await api(app.url, `/api/staff/orders?filter=${filter}`, { cookie: luis })).status, 200);
    }
  });

  test('excessive failed sign-ins are limited with generic retry guidance', async () => {
    const attempts = [];
    for (let i = 0; i < 6; i += 1) {
      attempts.push(await api(app.url, '/api/staff/session', { method: 'POST', body: { username: 'ghost-user', password: 'nope' } }));
    }
    assert.deepEqual(attempts.slice(0, 5).map((r) => r.status), [401, 401, 401, 401, 401]);
    assert.equal(attempts[5].status, 429);
    assert.equal(attempts[5].data.message, 'Too many sign-in attempts. Wait a few minutes, then try again.');
    assert.ok(Number(attempts[5].headers.get('retry-after')) > 0);
    // Guest ordering keeps working while sign-in is limited.
    assert.equal((await placeOrder(app.url)).status, 201);
  });
});

describe('B2/B3 detail and progress', () => {
  test('detail keeps accepted names and prices after the menu changes', async () => {
    const order = await newOrder();
    app.setMenuItem('M1', { price: 6000, available: false });
    app.db.prepare("UPDATE menu_items SET name = 'Renamed casado' WHERE code = 'M1'").run();
    try {
      const shown = await detail(order.orderNumber);
      assert.deepEqual(shown.items[0], { name: 'Chicken casado', quantity: 1, unitPrice: 4500, subtotal: 4500 });
      assert.equal(shown.total, 7900);
      assert.equal(shown.status, 'Received');
      assert.match(shown.submittedLabel, /^Tue, Nov 10, 12:0\d PM$/);
      assert.deepEqual(shown.allowedActions.map((a) => a.target), ['Preparing', 'Cancelled']);
    } finally {
      app.setMenuItem('M1', { price: 4500, available: true });
      app.db.prepare("UPDATE menu_items SET name = 'Chicken casado' WHERE code = 'M1'").run();
    }
  });

  test('the full lifecycle records employee and time; final states cannot change', async () => {
    const { orderNumber } = await newOrder();
    assert.equal((await change(orderNumber, { revision: 1, target: 'Ready' })).status, 422, 'no skipping');
    assert.equal((await change(orderNumber, { revision: 1, target: 'Preparing' })).status, 200);
    assert.equal((await change(orderNumber, { revision: 2, target: 'Ready' }, elena)).status, 200);
    const collected = await change(orderNumber, { revision: 3, target: 'Collected' });
    assert.equal(collected.status, 200);
    assert.deepEqual(
      collected.data.order.history.map(({ fromStatus, toStatus, employeeName }) => [fromStatus, toStatus, employeeName]),
      [
        ['Received', 'Preparing', 'Luis'],
        ['Preparing', 'Ready', 'Elena'],
        ['Ready', 'Collected', 'Luis'],
      ],
    );
    assert.ok(collected.data.order.history.every((entry) => /Nov 10/.test(entry.timeLabel)));
    const before = app.counts();
    for (const target of ['Received', 'Preparing', 'Ready', 'Cancelled']) {
      const response = await change(orderNumber, { revision: 4, target, reason: 'x' });
      assert.equal(response.status, 422, target);
    }
    assert.deepEqual(app.counts(), before);
  });

  test('cancellation requires a nonblank reason and shows it to staff and customer', async () => {
    const order = await newOrder();
    const before = app.counts();
    for (const reason of [undefined, '', '   ']) {
      const response = await change(order.orderNumber, { revision: 1, target: 'Cancelled', reason });
      assert.equal(response.status, 422);
      assert.equal(response.data.error, 'reason_required');
    }
    assert.deepEqual(app.counts(), before);
    const cancelled = await change(order.orderNumber, { revision: 1, target: 'Cancelled', reason: '  Kitchen equipment failure  ' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.order.cancellationReason, 'Kitchen equipment failure');
    const tracking = await api(app.url, `/api${order.trackingPath}`);
    assert.equal(tracking.data.guidance.reason, 'Kitchen equipment failure');
    assert.equal(tracking.data.guidance.contactLabel, 'Demo contact — not monitored');
  });

  test('competing changes from the same observed revision: one succeeds, one gets the current state', async () => {
    const { orderNumber } = await newOrder();
    const [a, b] = await Promise.all([
      change(orderNumber, { revision: 1, target: 'Preparing' }, luis),
      change(orderNumber, { revision: 1, target: 'Cancelled', reason: 'Duplicate ticket' }, elena),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const conflict = a.status === 409 ? a : b;
    const winner = a.status === 200 ? a : b;
    assert.equal(conflict.data.order.status, winner.data.order.status);
    assert.match(conflict.data.message, new RegExp(`Order ${orderNumber} changed before your update was saved`));
    const shown = await detail(orderNumber);
    assert.equal(shown.history.length, 1, 'the rejected change wrote nothing');
    // A new deliberate choice against the refreshed revision is valid.
    const next = shown.status === 'Preparing' ? 'Ready' : null;
    if (next) assert.equal((await change(orderNumber, { revision: shown.revision, target: next }, conflict === a ? luis : elena)).status, 200);
  });

  test('Q-CONSISTENCY local run: 100 conflicting same-state pairs give one success and one conflict each', async () => {
    let successes = 0;
    let conflicts = 0;
    for (let i = 0; i < 100; i += 1) {
      const { orderNumber } = await newOrder();
      const targets = i % 2 === 0 ? ['Preparing', 'Cancelled'] : ['Preparing', 'Preparing'];
      const responses = await Promise.all([
        change(orderNumber, { revision: 1, target: targets[0], reason: 'Unable to fulfil' }, luis),
        change(orderNumber, { revision: 1, target: targets[1], reason: 'Unable to fulfil' }, elena),
      ]);
      const codes = responses.map((r) => r.status).sort();
      assert.deepEqual(codes, [200, 409], `pair ${i}`);
      successes += 1;
      conflicts += 1;
      const current = await detail(orderNumber);
      assert.equal(current.history.length, 1);
      assert.equal(current.revision, 2);
      // Deliberate recovery: the losing employee retries against the new revision.
      if (current.status === 'Preparing') {
        const loserCookie = responses[0].status === 409 ? luis : elena;
        assert.equal((await change(orderNumber, { revision: 2, target: 'Ready' }, loserCookie)).status, 200);
      }
    }
    assert.equal(successes, 100);
    assert.equal(conflicts, 100);
  });

  test('a stale revision is rejected even when the action would be valid now', async () => {
    const { orderNumber } = await newOrder();
    await change(orderNumber, { revision: 1, target: 'Preparing' });
    const stale = await change(orderNumber, { revision: 1, target: 'Cancelled', reason: 'Too late' }, elena);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.order.status, 'Preparing');
    assert.equal((await detail(orderNumber)).history.length, 1);
  });

  test('staff may finish accepted orders after closing; missing orders are distinct', async () => {
    const { orderNumber } = await newOrder();
    app.clock.set(TIMES.closingInstant);
    try {
      assert.equal((await change(orderNumber, { revision: 1, target: 'Preparing' })).status, 200);
    } finally {
      app.clock.set(TIMES.open);
    }
    assert.equal((await change(999999, { revision: 1, target: 'Preparing' })).status, 404);
    assert.equal((await api(app.url, '/api/staff/orders/999999', { cookie: luis })).status, 404);
  });
});

describe('C1-C3 private tracking and ACCESS', () => {
  test('a private link shows only its order, without staff identities or internal details', async () => {
    const order = await newOrder();
    await change(order.orderNumber, { revision: 1, target: 'Preparing' });
    const response = await api(app.url, `/api${order.trackingPath}`);
    assert.equal(response.status, 200);
    assert.equal(response.data.orderNumber, order.orderNumber);
    assert.equal(response.data.status, 'Preparing');
    const text = JSON.stringify(response.data);
    for (const forbidden of ['Luis', 'Elena', 'luis', 'elena', 'revision', 'history', 'employee', 'privateToken']) {
      assert.equal(text.includes(forbidden), false, `snapshot must not contain ${forbidden}`);
    }
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });

  test('status guidance only invites collection when Ready', async () => {
    const order = await newOrder();
    const guidance = async () => (await api(app.url, `/api${order.trackingPath}`)).data.guidance;
    assert.equal((await guidance()).message, 'The restaurant has received your order. It is not ready for pickup yet.');
    await change(order.orderNumber, { revision: 1, target: 'Preparing' });
    assert.equal((await guidance()).message, 'Your meal is being prepared. It is not ready for pickup yet.');
    await change(order.orderNumber, { revision: 2, target: 'Ready' });
    const ready = await guidance();
    assert.equal(ready.readyForPickup, true);
    assert.equal(ready.pickupInstructions, 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.');
    assert.equal(ready.orderNumber, order.orderNumber);
    await change(order.orderNumber, { revision: 3, target: 'Collected' });
    const collected = await guidance();
    assert.equal(collected.readyForPickup, false);
    assert.equal(collected.pickupInstructions, undefined);
  });

  test('invalid, missing and guessed links disclose nothing and look identical', async () => {
    const { orderNumber } = await newOrder();
    const replies = await Promise.all(
      [String(orderNumber), 'A'.repeat(32), 'not-a-link', '', '%E0%A4%A'].map((token) => api(app.url, `/api/track/${token}`)),
    );
    for (const reply of replies.slice(0, 4)) {
      assert.equal(reply.status, 404);
      assert.deepEqual(reply.data, { error: 'link_unavailable', message: "We couldn't open this tracking link. Check the full saved link." });
    }
    assert.ok([400, 404].includes(replies[4].status));
  });

  test('protected staff routes refuse requests without a valid session, including direct API calls', async () => {
    const { orderNumber, trackingPath } = await newOrder();
    const before = app.counts();
    const token = trackingPath.split('/').pop();
    // '' (not undefined) so the helpers' default staff cookie is not applied.
    for (const cookie of ['', 'mesa_staff_session=forged', `mesa_staff_session=${token}`]) {
      assert.equal((await api(app.url, '/api/staff/orders', { cookie })).status, 401);
      assert.equal((await api(app.url, `/api/staff/orders/${orderNumber}`, { cookie })).status, 401);
      const write = await change(orderNumber, { revision: 1, target: 'Cancelled', reason: 'x' }, cookie);
      assert.equal(write.status, 401);
      assert.equal(JSON.stringify(write.data).includes('Chicken'), false);
    }
    assert.deepEqual(app.counts(), before);
    assert.equal((await detail(orderNumber)).status, 'Received');
  });
});
