import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { costaRica, OPEN_NOON, startApp } from './harness.js';

const id = () => randomBytes(18).toString('base64url');

let app;
let context;

const post = async (path, body) => {
  const response = await fetch(app.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};
const submit = (attempt, selection, ctx = context) => post('/api/orders', { context: ctx, attempt, selection });
const recover = (attempt, ctx = context) => post('/api/orders/recover', { context: ctx, attempt });
const orderCount = () => app.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

const WORKED_CART = [
  { itemId: 'M1', quantity: 1, reviewedPrice: 4500 },
  { itemId: 'S2', quantity: 1, reviewedPrice: 1400 },
  { itemId: 'D2', quantity: 2, reviewedPrice: 1000 },
];

before(async () => { app = await startApp(); });
after(() => app.stop());
beforeEach(() => {
  context = id();
  app.clock.t = OPEN_NOON;
  app.setPrice('M1', 4500);
  app.setAvailable('M3', false);
  app.setAvailable('M1', true);
});

test('A3 a valid guest order yields one Received order with accepted contents, number and private link', async () => {
  const before = orderCount();
  const { status, data } = await submit(id(), WORKED_CART);
  assert.equal(status, 200);
  assert.equal(data.outcome, 'accepted');
  assert.equal(data.status, 'Received');
  assert.equal(data.total, 7900);
  assert.deepEqual(data.items.map((i) => [i.name, i.quantity, i.price, i.subtotal]), [
    ['Chicken casado', 1, 4500, 4500], ['Cheese empanada', 1, 1400, 1400], ['Iced tea', 2, 1000, 2000],
  ]);
  assert.match(data.paymentInstructions, /pay at collection/);
  assert.ok(data.number >= 1001);
  assert.ok(Buffer.from(data.trackingPath.split('/').pop(), 'base64url').length * 8 >= 128);
  assert.equal(orderCount(), before + 1);
});

test('A2 worked example totals are exact', async () => {
  const totalOf = async (selection) => (await submit(id(), selection)).data.total;
  assert.equal(await totalOf(WORKED_CART.map((l) => (l.itemId === 'D2' ? { ...l, quantity: 3 } : l))), 8900);
  assert.equal(await totalOf(WORKED_CART.filter((l) => l.itemId !== 'S2')), 6500);
});

test('A3 empty, invalid and closed submissions are rejected without creating an order', async () => {
  const before = orderCount();
  const cases = [
    [[], 'empty'],
    ['not a list', 'empty'],
    [[{ itemId: 'M1', quantity: 0, reviewedPrice: 4500 }], 'invalid_quantity'],
    [[{ itemId: 'M1', quantity: -1, reviewedPrice: 4500 }], 'invalid_quantity'],
    [[{ itemId: 'M1', quantity: 1.5, reviewedPrice: 4500 }], 'invalid_quantity'],
    [[{ itemId: 'M1', quantity: '2', reviewedPrice: 4500 }], 'invalid_quantity'],
    [[{ itemId: 'M1', quantity: 1, reviewedPrice: 4500 }, { itemId: 'M1', quantity: 1, reviewedPrice: 4500 }], 'invalid_selection'],
    [[{ itemId: 'ZZ', quantity: 1, reviewedPrice: 100 }], 'unavailable'],
    [[{ itemId: 'M3', quantity: 1, reviewedPrice: 5000 }], 'unavailable'],
  ];
  for (const [selection, type] of cases) {
    const { status, data } = await submit(id(), selection);
    assert.equal(status, 422, type);
    assert.equal(data.corrections.at(-1).type, type);
  }
  app.clock.t = costaRica(9, 21);
  const closed = await submit(id(), WORKED_CART);
  assert.equal(closed.status, 422);
  assert.equal(closed.data.closed, true);
  assert.equal(closed.data.nextOpening, 'Tuesday, November 10, 10:00 AM');
  assert.equal(orderCount(), before);
});

test('A3 opening is inclusive and closing exclusive at the acceptance boundary', async () => {
  app.clock.t = costaRica(9, 10);
  assert.equal((await submit(id(), WORKED_CART)).status, 200);
  app.clock.t = costaRica(9, 20, 59, 59);
  assert.equal((await submit(id(), WORKED_CART)).status, 200);
  app.clock.t = costaRica(9, 21);
  assert.equal((await submit(id(), WORKED_CART)).status, 422);
});

test('A3-REVIEW a repriced dish in either direction needs review, then a fresh attempt is accepted at the new total', async () => {
  const before = orderCount();
  app.setPrice('M1', 4600);
  const attempt = id();
  const rejected = await submit(attempt, WORKED_CART);
  assert.equal(rejected.status, 422);
  assert.deepEqual(rejected.data.corrections, [{ type: 'price_changed', itemId: 'M1', name: 'Chicken casado', price: 4600 }]);
  assert.equal(orderCount(), before);

  const reviewed = WORKED_CART.map((l) => (l.itemId === 'M1' ? { ...l, reviewedPrice: 4600 } : l));
  const accepted = await submit(id(), reviewed);
  assert.equal(accepted.data.total, 8000);

  app.setPrice('M1', 4400);
  assert.equal((await submit(id(), reviewed)).data.corrections[0].type, 'price_changed');
});

test('A3-REVIEW an unavailable or removed dish stays identified and nothing is substituted', async () => {
  app.setAvailable('M1', false);
  const unavailable = await submit(id(), WORKED_CART);
  assert.deepEqual(unavailable.data.corrections, [{ type: 'unavailable', itemId: 'M1', name: 'Chicken casado' }]);
  app.setAvailable('M1', true);
  const removed = await submit(id(), [{ itemId: 'OLD', quantity: 1, reviewedPrice: 900 }]);
  assert.deepEqual(removed.data.corrections, [{ type: 'unavailable', itemId: 'OLD', name: null }]);
});

test('A4 repeated attempts return the same accepted result and create one order', async () => {
  const before = orderCount();
  const attempt = id();
  const first = await submit(attempt, WORKED_CART);
  const second = await submit(attempt, WORKED_CART);
  assert.deepEqual(second.data, first.data);
  assert.equal(orderCount(), before + 1);
});

test('A4 simultaneous attempts for one submission create exactly one order', async () => {
  const before = orderCount();
  const attempt = id();
  const results = await Promise.all(Array.from({ length: 25 }, () => submit(attempt, WORKED_CART)));
  assert.equal(new Set(results.map((r) => r.data.number)).size, 1);
  assert.equal(new Set(results.map((r) => r.data.trackingPath)).size, 1);
  assert.equal(orderCount(), before + 1);
});

test('A4 a lost confirmation is recovered, including after closing and a later menu change', async () => {
  const attempt = id();
  const first = await submit(attempt, WORKED_CART);
  app.clock.t = costaRica(9, 22);
  app.setPrice('M1', 9999);
  assert.deepEqual((await recover(attempt)).data, first.data);
  assert.deepEqual((await submit(attempt, WORKED_CART)).data, first.data);
});

test('A4 an attempt with no established outcome stays unresolved, then can be retried safely', async () => {
  const attempt = id();
  const check = await recover(attempt);
  assert.deepEqual([check.status, check.data.outcome], [200, 'unresolved']);
  assert.equal((await submit(attempt, WORKED_CART)).data.outcome, 'accepted');
});

test('A4 a definitive rejection cannot turn into acceptance on retry', async () => {
  const before = orderCount();
  const attempt = id();
  app.clock.t = costaRica(9, 22);
  const rejected = await submit(attempt, WORKED_CART);
  assert.equal(rejected.status, 422);
  app.clock.t = OPEN_NOON; // conditions are now fine; the attempt stays closed
  const retried = await submit(attempt, WORKED_CART);
  assert.equal(retried.status, 422);
  assert.equal(retried.data.closed, true);
  const recovered = await recover(attempt);
  assert.equal(recovered.data.outcome, 'rejected');
  assert.equal(orderCount(), before);
});

test('A4 a deliberate new order is a separate order', async () => {
  const one = await submit(id(), WORKED_CART);
  const two = await submit(id(), WORKED_CART);
  assert.notEqual(one.data.number, two.data.number);
  assert.notEqual(one.data.trackingPath, two.data.trackingPath);
});

test('A4 a different selection under an accepted attempt is not ordered and is flagged', async () => {
  const before = orderCount();
  const attempt = id();
  const first = await submit(attempt, WORKED_CART);
  const changed = await submit(attempt, [{ itemId: 'D1', quantity: 5, reviewedPrice: 1300 }]);
  assert.equal(changed.data.number, first.data.number);
  assert.equal(changed.data.total, first.data.total);
  assert.equal(changed.data.selectionMismatch, true);
  assert.equal(orderCount(), before + 1);
});

test('A4 recovery is scoped: another customer learns nothing from the same attempt id', async () => {
  const attempt = id();
  const mine = await submit(attempt, WORKED_CART);
  const stranger = id();
  assert.equal((await recover(attempt, stranger)).data.outcome, 'unresolved');
  const theirs = await submit(attempt, WORKED_CART, stranger);
  assert.notEqual(theirs.data.number, mine.data.number);
  assert.notEqual(theirs.data.trackingPath, mine.data.trackingPath);
});

test('A3 malformed attempt identifiers and non-JSON requests are refused without recording anything', async () => {
  const before = orderCount();
  assert.equal((await post('/api/orders', { context: 'short', attempt: id(), selection: WORKED_CART })).status, 400);
  assert.equal((await post('/api/orders', { context, attempt: ['x'.repeat(20)], selection: WORKED_CART })).status, 400);
  const form = await fetch(`${app.base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 415);
  assert.equal(orderCount(), before);
});

test('A5 a recovered order keeps its identity but reports current state and payment guidance', async () => {
  const attempt = id();
  const { data } = await submit(attempt, WORKED_CART);
  app.db.prepare("UPDATE orders SET status = 'Preparing', revision = 2 WHERE number = ?").run(data.number);
  const preparing = (await recover(attempt)).data;
  assert.equal(preparing.status, 'Preparing');
  assert.ok(preparing.paymentInstructions);
  app.db.prepare("UPDATE orders SET status = 'Cancelled', revision = 3, cancellation_reason = 'Out of rice' WHERE number = ?").run(data.number);
  const cancelled = (await recover(attempt)).data;
  assert.equal(cancelled.status, 'Cancelled');
  assert.equal(cancelled.paymentInstructions, null);
  assert.equal(cancelled.number, data.number);
  app.db.prepare("UPDATE orders SET status = 'Collected', revision = 4 WHERE number = ?").run(data.number);
  assert.equal((await recover(attempt)).data.paymentInstructions, null);
});
