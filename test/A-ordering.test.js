import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, memoryStorage, newId, tokenOf, LUNCH } from './helpers.js';
import { Cart } from '../a-ordering/Cart.js';

const DISH = {
  M1: { code: 'M1', name: 'Chicken casado', price: 4500, available: true },
  M3: { code: 'M3', name: 'Fish casado', price: 5000, available: false },
  S2: { code: 'S2', name: 'Cheese empanada', price: 1400, available: true },
  D2: { code: 'D2', name: 'Iced tea', price: 1000, available: true },
};

test('A1 browse menu', async (t) => {
  const app = await startApp(t);
  const menuAt = async (iso) => {
    app.clock.now = new Date(iso);
    const { status, body } = await app.call('GET', '/api/menu');
    assert.equal(status, 200);
    return body;
  };

  await t.test('9 dishes in order, all fields, M3 unavailable', async () => {
    const { dishes } = await menuAt('2026-11-06T18:00:00Z');
    assert.deepEqual(dishes.map((d) => d.code), ['M1', 'M2', 'M3', 'S1', 'S2', 'S3', 'S4', 'D1', 'D2']);
    for (const d of dishes) assert.deepEqual(Object.keys(d).sort(), ['available', 'code', 'description', 'name', 'price']);
    assert.deepEqual(dishes[0], { code: 'M1', name: 'Chicken casado', description: 'Rice, beans, chicken, salad and plantain.', price: 4500, available: true });
    assert.deepEqual(dishes.filter((d) => !d.available).map((d) => d.code), ['M3']);
  });

  await t.test('open at 10:00 and 20:59 Costa Rica time (16:00 and 02:59 UTC)', async () => {
    for (const iso of ['2026-11-06T16:00:00Z', '2026-11-07T02:59:00Z', '2026-11-07T02:59:59Z']) {
      const body = await menuAt(iso);
      assert.equal(body.open, true, iso);
      assert.equal(body.nextOpening, null);
    }
  });

  await t.test('closed at 09:59 and 21:00, with the next opening; dishes still listed', async () => {
    const early = await menuAt('2026-11-06T15:59:00Z');
    assert.equal(early.open, false);
    assert.equal(early.nextOpening, '2026-11-06T16:00:00.000Z'); // 10:00 the same day
    assert.equal(early.dishes.length, 9);
    const late = await menuAt('2026-11-07T03:00:00Z');
    assert.equal(late.open, false);
    assert.equal(late.nextOpening, '2026-11-07T16:00:00.000Z'); // 10:00 the next day
    const midnight = await menuAt('2026-11-07T06:00:00Z'); // 00:00 Costa Rica
    assert.equal(midnight.nextOpening, '2026-11-07T16:00:00.000Z');
  });
});

test('A2 edit cart', async (t) => {
  const storage = memoryStorage();
  const cart = new Cart(storage);
  cart.add(DISH.M1);
  cart.add(DISH.S2);
  cart.add(DISH.D2);
  cart.add(DISH.D2);

  await t.test('total matches the check values: 1 M1 + 1 S2 + 2 D2 = 7900', () => {
    assert.equal(cart.total(), 7900);
  });

  await t.test('setQuantity refuses 0, -1, 1.5, abc and empty; cart unchanged', () => {
    const before = storage.getItem('mesaTica.cart');
    for (const bad of ['0', '-1', '1.5', 'abc', '', '  ', '2x', '1e1', '+2', '100', 0, -1, 1.5, null, undefined]) {
      assert.equal(cart.setQuantity('D2', bad), false, `refuses ${JSON.stringify(bad)}`);
      assert.equal(storage.getItem('mesaTica.cart'), before);
    }
    assert.equal(cart.items.find((i) => i.code === 'D2').quantity, 2);
    assert.equal(cart.total(), 7900);
  });

  await t.test('D2 to 3: 8900; remove S2: 6500', () => {
    assert.equal(cart.setQuantity('D2', '3'), true);
    assert.equal(cart.total(), 8900);
    cart.setQuantity('D2', ' 2 ');
    cart.remove('S2');
    assert.equal(cart.total(), 6500);
    assert.deepEqual(cart.items.map((i) => i.code), ['M1', 'D2']);
  });

  await t.test('unavailable dishes cannot be added; a reload keeps the cart', () => {
    assert.equal(cart.add(DISH.M3), false);
    const reloaded = new Cart(storage);
    assert.deepEqual(reloaded.items, cart.items);
    assert.equal(reloaded.total(), 6500);
  });
});

test('A3 place order', async (t) => {
  const app = await startApp(t);
  const orderRows = (submissionId) => app.rows('SELECT number FROM "Order" WHERE submissionId = ?', submissionId);
  const countOrders = () => app.rows('SELECT COUNT(*) AS n FROM "Order"')[0].n;
  let first;
  const firstId = newId();

  await t.test('a valid order: Received, unique number, 128-bit token', async () => {
    const res = await app.place(LUNCH, firstId);
    assert.equal(res.status, 201);
    first = res.body;
    assert.equal(first.status, 'Received');
    assert.equal(first.total, 7900);
    assert.equal(first.submittedAt, app.clock.now.toISOString());
    assert.deepEqual(first.lines, [
      { dishName: 'Chicken casado', price: 4500, quantity: 1 },
      { dishName: 'Cheese empanada', price: 1400, quantity: 1 },
      { dishName: 'Iced tea', price: 1000, quantity: 2 },
    ]);
    assert.match(first.trackingLink, /^\/track\/[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(tokenOf(first), 'base64url').length, 16);
    const second = (await app.place()).body;
    assert.notEqual(second.number, first.number);
    assert.notEqual(second.trackingLink, first.trackingLink);
  });

  await t.test('resent: the same order and one row, whatever items arrive', async () => {
    const again = await app.place([{ code: 'D1', price: 1300, quantity: 5 }], firstId);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first);
    assert.equal(orderRows(firstId).length, 1);
  });

  await t.test('sent twice at once: same order, one row', async () => {
    const id = newId();
    const [a, b] = await Promise.all([app.place(LUNCH, id), app.place(LUNCH, id)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    assert.equal(a.body.number, b.body.number);
    assert.equal(orderRows(id).length, 1);
  });

  await t.test('resent after closing: same order; a new id is refused as closed', async () => {
    app.clock.now = new Date('2026-11-07T02:58:00Z'); // 20:58 Costa Rica
    const id = newId();
    const placed = await app.place(LUNCH, id);
    assert.equal(placed.status, 201);
    app.clock.now = new Date('2026-11-07T03:30:00Z'); // 21:30, closed
    const resent = await app.place(LUNCH, id);
    assert.equal(resent.status, 200);
    assert.equal(resent.body.number, placed.body.number);
    const fresh = await app.place();
    assert.equal(fresh.status, 422);
    assert.deepEqual(fresh.body, { reason: 'closed', nextOpening: '2026-11-07T16:00:00.000Z' });
    app.clock.now = new Date('2026-11-06T18:00:00Z');
  });

  await t.test('refused with 422 and no order: empty, bad quantity, closed, changed price, unavailable dish', async () => {
    const cases = [
      [[], 'empty'],
      [undefined, 'empty'],
      ...[0, -1, 1.5, '1', '1.5', null, 100].map((q) => [[{ code: 'M1', price: 4500, quantity: q }], 'bad_quantity']),
      [[{ code: 'M1', price: 4000, quantity: 1 }], 'menu_changed'],
      [[{ code: 'M3', price: 5000, quantity: 1 }], 'menu_changed'],
      [[{ code: 'X9', price: 100, quantity: 1 }], 'menu_changed'],
    ];
    const before = countOrders();
    for (const [items, reason] of cases) {
      const id = newId();
      const res = await app.call('POST', '/api/orders', { submissionId: id, items });
      assert.equal(res.status, 422, JSON.stringify(items));
      assert.equal(res.body.reason, reason, JSON.stringify(items));
      if (reason === 'menu_changed') assert.equal(res.body.menu.length, 9);
      assert.equal(orderRows(id).length, 0);
    }
    app.clock.now = new Date('2026-11-06T15:00:00Z'); // 09:00 Costa Rica
    const closed = await app.place();
    assert.deepEqual(closed.body, { reason: 'closed', nextOpening: '2026-11-06T16:00:00.000Z' });
    app.clock.now = new Date('2026-11-06T18:00:00Z');
    for (const bad of [undefined, '', 'short', 'x'.repeat(101), 'has spaces in it', 42]) {
      assert.deepEqual((await app.call('POST', '/api/orders', { submissionId: bad, items: LUNCH })).body, { reason: 'bad_submission' });
    }
    assert.equal(countOrders(), before);
  });

  await t.test('a rejected submissionId resent after the fix is accepted', async () => {
    const id = newId();
    const stale = await app.place([{ code: 'M1', price: 4000, quantity: 1 }], id);
    assert.equal(stale.status, 422);
    const cart = new Cart(memoryStorage());
    cart.add({ ...DISH.M1, price: 4000 });
    const changes = cart.updatePrices(stale.body.menu);
    assert.deepEqual(changes, [{ name: 'Chicken casado', from: 4000, to: 4500 }]);
    const fixed = await app.place(cart.getSubmission().items, id);
    assert.equal(fixed.status, 201);
    assert.equal(fixed.body.total, 4500);
  });

  await t.test('Cart keeps one submissionId until clear()', () => {
    const storage = memoryStorage();
    const cart = new Cart(storage);
    cart.add(DISH.M1);
    const a = cart.getSubmission();
    assert.match(a.submissionId, /^[0-9a-f]{32}$/);
    cart.setQuantity('M1', '2');
    assert.equal(new Cart(storage).getSubmission().submissionId, a.submissionId); // survives a reload
    assert.deepEqual(cart.getSubmission().items, [{ code: 'M1', price: 4500, quantity: 2 }]);
    cart.clear();
    assert.deepEqual(cart.items, []);
    cart.add(DISH.M1);
    assert.notEqual(cart.getSubmission().submissionId, a.submissionId);
    assert.deepEqual(new Cart(memoryStorage()).updatePrices([]), []);
    cart.add(DISH.D2);
    assert.deepEqual(cart.updatePrices([{ ...DISH.D2, available: false }]), [
      { name: 'Chicken casado', removed: true },
      { name: 'Iced tea', removed: true },
    ]);
  });
});

test('A3 100 mixed submissions give one order per accepted id', async (t) => {
  const app = await startApp(t);
  const accepted = Array.from({ length: 30 }, newId);
  const requests = [];
  accepted.forEach((id, i) => {
    for (let k = 0; k <= i % 3; k++) requests.push({ id, items: LUNCH, ok: true }); // sent 1, 2 or 3 times
  });
  const refusals = [[], [{ code: 'M1', price: 4500, quantity: 0 }], [{ code: 'M3', price: 5000, quantity: 1 }], [{ code: 'M1', price: 1, quantity: 1 }]];
  while (requests.length < 100) requests.push({ id: newId(), items: refusals[requests.length % 4], ok: false });
  requests.sort((a, b) => a.id.localeCompare(b.id)); // mix, and keep repeats of one id next to each other

  const results = [];
  for (let i = 0; i < requests.length; i += 10) {
    const batch = requests.slice(i, i + 10); // 10 at once, so some repeats are concurrent
    results.push(...(await Promise.all(batch.map((r) => app.place(r.items, r.id).then((res) => ({ ...r, res }))))));
  }
  assert.equal(results.length, 100);
  const numbers = new Map();
  for (const r of results) {
    if (r.ok) {
      assert.ok([200, 201].includes(r.res.status));
      if (numbers.has(r.id)) assert.equal(r.res.body.number, numbers.get(r.id));
      numbers.set(r.id, r.res.body.number);
    } else {
      assert.equal(r.res.status, 422);
    }
  }
  assert.equal(results.filter((r) => r.res.status === 201).length, 30);
  assert.equal(app.rows('SELECT COUNT(*) AS n FROM "Order"')[0].n, 30);
  assert.equal(new Set(numbers.values()).size, 30);
});
