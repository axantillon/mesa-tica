import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { application } from '../src/server.js';
import { setup } from '../src/setup.js';
import { openDatabase } from '../src/store.js';
import { token } from '../src/orders.js';

const selection = [
  { code: 'M1', quantity: 1, price: 4500 },
  { code: 'S2', quantity: 1, price: 1400 },
  { code: 'D2', quantity: 2, price: 1000 },
];

test('HTTP guest ordering serializes acceptance, recovery and review', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mesa-checkout-'));
  setup(directory);
  const db = openDatabase(directory);
  let clock = '2026-11-05T15:59:59Z';
  const server = application({ directory, now: () => new Date(clock) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const api = async (path, body) => {
    const response = await fetch(origin + '/api/' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const customer = token();
  const attempt = (lines = selection) => ({ customer, attempt: token(), selection: lines });
  const submit = (body) => api('checkout/submit', body);
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

  const menu = await api('menu');
  assert.equal(menu.menu.length, 9);
  assert.equal(menu.menu.find((dish) => dish.code === 'M3').available, 0);
  assert.deepEqual(menu.opening, { open: false, next: { date: '2026-11-05', time: '10:00' } });
  const closed = attempt();
  assert.equal((await submit(closed)).issue, 'closed');
  clock = '2026-11-05T16:00:00Z';
  assert.equal((await api('menu')).opening.open, true);
  assert.equal((await submit(closed)).issue, 'closed');
  for (const quantity of [0, -1, 1.5, '3', 'banana']) {
    assert.equal((await submit(attempt([{ ...selection[0], quantity }]))).issue, 'invalid_selection');
  }
  assert.equal((await submit(attempt([]))).issue, 'empty');
  assert.equal((await submit(attempt([{ code: 'M3', quantity: 1, price: 5000 }]))).corrections[0].issue, 'unavailable');
  assert.equal(count(), 0);

  const reviewed = attempt();
  const [accepted, repeated] = await Promise.all([submit(reviewed), submit(reviewed)]);
  assert.deepEqual(accepted, repeated);
  assert.equal(accepted.order.status, 'Received');
  assert.equal(accepted.order.total, 7900);
  assert.equal(count(), 1);
  assert.match(accepted.trackingPath, /^\/track\/[a-f0-9]{64}$/);
  assert.equal((await api('checkout/check', { ...reviewed, customer: token() })).outcome, 'unresolved');
  assert.equal((await api('checkout/check', closed)).outcome, 'unresolved');
  const mismatch = await submit({ ...reviewed, selection: [] });
  assert.equal(mismatch.differentSelection, true);
  assert.deepEqual(mismatch.order, accepted.order);
  assert.deepEqual((await api(accepted.trackingPath.slice(1))).order, accepted.order);
  assert.equal((await api('track/' + accepted.order.number)).status, 404);

  db.exec("UPDATE menu SET price = 4600 WHERE code = 'M1'");
  const stale = attempt();
  const correction = await submit(stale);
  assert.deepEqual(correction.corrections, [{ code: 'M1', issue: 'price_changed', price: 4600 }]);
  const updated = [{ ...selection[0], price: 4600 }, ...selection.slice(1)];
  assert.deepEqual(await submit({ ...stale, selection: updated }), correction);
  const second = await submit(attempt(updated));
  assert.equal(second.order.total, 8000);
  assert.notEqual(second.order.number, accepted.order.number);
  db.exec("UPDATE menu SET price = 4300 WHERE code = 'M1'; DELETE FROM menu WHERE code = 'S2';");
  assert.deepEqual((await submit(attempt(updated))).corrections, [
    { code: 'M1', issue: 'price_changed', price: 4300 }, { code: 'S2', issue: 'unavailable' },
  ]);

  clock = '2026-11-06T03:00:00Z';
  assert.deepEqual((await api('menu')).opening, { open: false, next: { date: '2026-11-06', time: '10:00' } });
  assert.deepEqual(await submit(reviewed), accepted);
  assert.deepEqual(await api('checkout/check', reviewed), accepted);
  assert.equal(count(), 2);
  db.exec("UPDATE restaurant SET config = json_set(config, '$.hours', json('[null,null,null,null,null,null,null]'))");
  assert.deepEqual((await api('menu')).opening, { open: false, next: null });
});
