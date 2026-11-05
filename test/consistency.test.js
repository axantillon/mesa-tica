import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { application } from '../src/server.js';
import { setup } from '../src/setup.js';
import { openDatabase } from '../src/store.js';
import { token } from '../src/orders.js';

test('100 mixed HTTP submissions and 100 competing staff pairs preserve order consistency', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mesa-consistency-'));
  const passwords = JSON.parse(readFileSync(setup(directory), 'utf8'));
  const db = openDatabase(directory);
  let clock = '2026-11-05T22:00:00Z';
  const server = application({ directory, now: () => new Date(clock) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true });
  });

  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, cookie) => fetch(origin + '/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const selection = [{ code: 'D2', price: 1000, quantity: 2 }];
  const attempt = (lines = selection) => ({ customer: token(), attempt: token(), selection: lines });
  const submit = async (body) => (await post('checkout/submit', body)).json();
  const orderNumbers = new Set();
  const trackingPaths = new Set();
  const lost = [];
  const accept = (response) => {
    assert.equal(response.outcome, 'accepted');
    assert.equal(response.order.total, 2000);
    orderNumbers.add(response.order.number);
    trackingPaths.add(response.trackingPath);
  };

  for (let index = 0; index < 25; index++) {
    accept(await submit(attempt()));

    const repeat = attempt();
    const responses = await Promise.all([submit(repeat), submit(repeat), submit(repeat)]);
    for (const response of responses) assert.deepEqual(response, responses[0]);
    accept(responses[0]);

    const ignored = attempt();
    // Let the real server complete the write but discard the body like a client missing its result.
    const response = await post('checkout/submit', ignored);
    assert.equal(response.status, 200);
    await response.body.cancel();
    lost.push(ignored);

    const invalid = attempt([{ ...selection[0], quantity: 0 }]);
    const rejected = await submit(invalid);
    assert.equal(rejected.outcome, 'rejected');
    assert.deepEqual(await submit({ ...invalid, selection }), rejected);
  }

  clock = '2026-11-06T03:00:00Z';
  for (const identity of lost) {
    const recovered = await submit(identity);
    assert.deepEqual(await (await post('checkout/check', identity)).json(), recovered);
    accept(recovered);
  }
  assert.equal(orderNumbers.size, 75);
  assert.equal(trackingPaths.size, 75);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 75);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE rejection IS NOT NULL').get().n, 25);

  clock = '2026-11-05T22:00:00Z';
  const cookies = await Promise.all(['luis', 'elena'].map(async (username) => {
    const response = await post('staff/sign-in', { username, password: passwords[username] });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }));
  const change = (order, employee, body) => post('staff/orders/' + order, body, cookies[employee]);
  for (let index = 0; index < 100; index++) {
    const { order } = await submit(attempt());
    const results = await Promise.all([
      change(order.number, 0, { revision: 0, target: 'Preparing' }),
      change(order.number, 1, { revision: 0, target: 'Preparing' }),
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    const successIndex = results.findIndex((response) => response.status === 200);
    const [success, conflict] = await Promise.all([results[successIndex].json(), results[1 - successIndex].json()]);
    assert.equal(success.outcome, 'changed');
    assert.equal(conflict.outcome, 'conflict');
    assert.deepEqual(conflict.order, success.order);
    assert.deepEqual(conflict.history, success.history);
    assert.equal(conflict.history.length, 1);
    assert.equal(conflict.history[0].employee, ['Luis', 'Elena'][successIndex]);
    assert.equal(conflict.order.revision, 1);
    const next = await change(order.number, 1 - successIndex, { revision: conflict.order.revision, target: 'Ready' });
    assert.equal(next.status, 200);
    const progressed = await next.json();
    assert.equal(progressed.order.status, 'Ready');
    assert.deepEqual(progressed.history.map((entry) => entry.employee), successIndex === 0 ? ['Luis', 'Elena'] : ['Elena', 'Luis']);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 175);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM status_changes').get().n, 200);
});
