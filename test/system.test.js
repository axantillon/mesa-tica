import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startApp, tempDir, tokenOf, newId, LUNCH } from './helpers.js';
import { setup } from '../setup.js';
import { createApp, serverClock } from '../server.js';

test('data survives a restart', async (t) => {
  const dataDir = tempDir(t);
  const first = await startApp(t, { dataDir });
  const submissionId = newId();
  const placed = (await first.place(LUNCH, submissionId)).body;
  const luis = await first.signIn('luis');
  await first.changeStatus(luis, placed.number, 1, 'Cancelled', 'Closed early');
  await first.stop();

  const second = await startApp(t, { dataDir }); // runs setup again: must not overwrite or duplicate
  const tracking = await second.call('GET', `/api/track/${tokenOf(placed)}`);
  assert.equal(tracking.status, 200);
  assert.equal(tracking.body.status, 'Cancelled');
  assert.equal(tracking.body.cancellationReason, 'Closed early');
  assert.equal(second.rows('SELECT COUNT(*) AS n FROM Dish')[0].n, 9);
  assert.equal(second.rows('SELECT COUNT(*) AS n FROM StaffAccount')[0].n, 2);
  assert.equal((await second.call('GET', '/api/staff/orders?status=Cancelled', undefined, luis)).body.orders.length, 1);
  const retry = await second.place(LUNCH, submissionId); // a retry after the restart: same order
  assert.deepEqual([retry.status, retry.body.number], [200, placed.number]);
});

test('setup adds only what is missing and generates unset passwords once', async (t) => {
  const dataDir = tempDir(t);
  const logs = [];
  setup(dataDir, { STAFF_PASSWORD_LUIS: 'given-password' }, (line) => logs.push(line));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Generated password for elena: /);
  const saved = readFileSync(join(dataDir, 'staff-credentials.txt'), 'utf8');
  assert.match(saved, /^elena: [\w-]{16}\n$/);
  const elenaPassword = saved.trim().split(': ')[1];

  setup(dataDir, { STAFF_PASSWORD_LUIS: 'another', STAFF_PASSWORD_ELENA: 'another' }, (line) => logs.push(line));
  assert.equal(logs.length, 1); // nothing new, nothing overwritten
  assert.equal(readFileSync(join(dataDir, 'staff-credentials.txt'), 'utf8'), saved);

  const server = createApp({ dataDir, now: () => new Date('2026-11-06T18:00:00Z') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const signIn = (username, password) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/staff/sign-in`, { method: 'POST', body: JSON.stringify({ username, password }) }).then((r) => r.status);
  assert.equal(await signIn('luis', 'given-password'), 200);
  assert.equal(await signIn('luis', 'another'), 401);
  assert.equal(await signIn('elena', elenaPassword), 200);
});

test('server refuses to start before setup, and TEST_NOW starts the clock', (t) => {
  const dataDir = tempDir(t);
  assert.throws(() => createApp({ dataDir }), /npm run setup/);
  assert.ok(existsSync(join(dataDir, 'mesa.sqlite')));
  const clock = serverClock('2026-11-07T03:30:00Z');
  assert.ok(Math.abs(clock() - Date.parse('2026-11-07T03:30:00Z')) < 1000);
  assert.ok(Math.abs(serverClock()() - Date.now()) < 1000);
  assert.throws(() => serverClock('not a date'));
});

test('pages and scripts are served; server code and unknown routes are not', async (t) => {
  const app = await startApp(t);
  for (const [path, type] of [
    ['/', 'text/html'], ['/staff', 'text/html'], ['/track/anything', 'text/html'],
    ['/a-ordering/MenuPage.js', 'text/javascript'], ['/a-ordering/Cart.js', 'text/javascript'],
    ['/b-staff/StaffPage.js', 'text/javascript'], ['/c-tracking/TrackingPage.js', 'text/javascript'],
    ['/shared/Poller.js', 'text/javascript'], ['/shared/ui.js', 'text/javascript'], ['/shared/style.css', 'text/css'],
  ]) {
    const res = await app.call('GET', path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), new RegExp(`^${type}`), path);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; frame-ancestors 'none'");
  }
  for (const path of ['/shared/stores.js', '/a-ordering/OrderingController.js', '/server.js', '/data/mesa.sqlite', '/track/', '/api/nope', '/api/orders']) {
    assert.equal((await app.call('GET', path)).status, 404, path);
  }
  assert.equal((await app.call('POST', '/api/orders', 'not json')).body.reason, 'bad_submission');
});
