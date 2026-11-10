import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, test } from 'node:test';
import { loadConfig, projectRoot } from '../../src/config.js';
import { openDatabase } from '../../src/db.js';
import { CREDENTIALS_FILE, runSetup } from '../../src/setup.js';
import { api, counts, makeDataDir, placeOrder, readCredentials, signIn, startTestServer, uniqueId } from '../support/harness.js';

const children = new Set();
after(() => {
  for (const child of children) child.kill('SIGKILL');
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Restaurant file with all-day hours, so the real-clock server accepts orders whenever the test runs. */
function allDayRestaurantFile(dir) {
  const content = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config', 'restaurant.json'), 'utf8'));
  for (const day of Object.keys(content.restaurant.weeklyHours)) content.restaurant.weeklyHours[day] = [{ open: '00:00', close: '24:00' }];
  const file = path.join(dir, 'restaurant-all-day.json');
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

/** Starts the real production entry point (src/server.js) and resolves with its announced base URL. */
function startServerProcess(env) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(projectRoot, 'src', 'server.js')], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 10000);
    const onData = (chunk) => {
      output += chunk;
      const match = /running at (http:\/\/\S+?)\/ /.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[1], output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => reject(new Error(`Server exited (${code}):\n${output}`)));
  });
}

function stopServerProcess(child) {
  return new Promise((resolve) => {
    child.once('exit', () => {
      children.delete(child);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

test('SETUP: repeated setup does not duplicate menu data, reset passwords or delete orders', async () => {
  const dataDir = makeDataDir();
  const config = loadConfig({ MESA_DATA_DIR: dataDir });
  const db = openDatabase(dataDir);
  const first = await runSetup({ db, config });
  assert.deepEqual(first.createdStaff, ['luis', 'elena']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n, 9);
  assert.equal(counts(db).orders, 0, 'no preset customer orders');
  const hashes = db.prepare('SELECT username, password_hash FROM employees ORDER BY id').all().map((row) => ({ ...row }));
  const credentialsText = fs.readFileSync(path.join(dataDir, CREDENTIALS_FILE), 'utf8');
  assert.equal((fs.statSync(path.join(dataDir, CREDENTIALS_FILE)).mode & 0o777).toString(8), '600');
  db.close();

  // Use the app, then run setup again.
  const app = await startTestServer({ dataDir });
  const placed = await placeOrder(app.url);
  const cookie = await signIn(app.url, 'luis', app.credentials.luis);
  await api(app.url, `/api/staff/orders/${placed.data.confirmation.orderNumber}/status`, { method: 'POST', cookie, body: { revision: 1, target: 'Preparing' } });
  app.db.prepare("UPDATE menu_items SET price = 4700 WHERE code = 'M1'").run();
  const before = app.counts();
  await app.close();

  const db2 = openDatabase(dataDir);
  const second = await runSetup({ db: db2, config });
  assert.deepEqual(second.createdStaff, []);
  assert.equal(second.menuLoaded, false);
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n, 9);
  assert.equal(db2.prepare("SELECT price FROM menu_items WHERE code = 'M1'").get().price, 4700, 'operator menu values preserved');
  assert.deepEqual(db2.prepare('SELECT username, password_hash FROM employees ORDER BY id').all().map((row) => ({ ...row })), hashes);
  assert.equal(fs.readFileSync(path.join(dataDir, CREDENTIALS_FILE), 'utf8'), credentialsText);
  assert.deepEqual(counts(db2), before);

  // An operator-emptied menu stays empty; the menu shows ordering unavailable.
  db2.prepare('DELETE FROM menu_items').run();
  await runSetup({ db: db2, config });
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n, 0);
  db2.close();
  const emptied = await startTestServer({ dataDir });
  const menu = await api(emptied.url, '/api/menu');
  assert.deepEqual(menu.data.groups, []);
  assert.equal(menu.data.ordering.acceptingOrders, false);
  assert.equal(menu.data.ordering.message, 'Ordering is unavailable right now because the menu has no dishes.');
  await emptied.close();
});

test('RUN: the production entry honours nondefault host/port/data settings and keeps state across restarts', async () => {
  const dataDir = makeDataDir('mesa-run-');
  const port = await freePort();
  const env = {
    MESA_HOST: 'localhost',
    MESA_PORT: String(port),
    MESA_DATA_DIR: path.join(dataDir, 'nested', 'store'),
    MESA_RESTAURANT_FILE: allDayRestaurantFile(dataDir),
  };
  const first = await startServerProcess(env);
  assert.match(first.url, new RegExp(`:${port}$`));
  assert.match(first.output, /Staff accounts created: luis, elena/);
  assert.doesNotMatch(first.output, new RegExp(readCredentials(env.MESA_DATA_DIR).luis), 'passwords are never printed');
  const placed = await placeOrder(first.url);
  assert.equal(placed.status, 201);
  const { orderNumber, trackingPath } = placed.data.confirmation;
  const password = readCredentials(env.MESA_DATA_DIR).elena;
  const cookie = await signIn(first.url, 'elena', password);
  await api(first.url, `/api/staff/orders/${orderNumber}/status`, { method: 'POST', cookie, body: { revision: 1, target: 'Preparing' } });
  await stopServerProcess(first.child);

  const second = await startServerProcess(env);
  assert.match(second.output, /Staff accounts created: none/);
  const tracking = await api(second.url, `/api${trackingPath}`);
  assert.equal(tracking.status, 200);
  assert.equal(tracking.data.status, 'Preparing');
  const cookie2 = await signIn(second.url, 'elena', password);
  const detail = await api(second.url, `/api/staff/orders/${orderNumber}`, { cookie: cookie2 });
  assert.deepEqual(detail.data.order.history.map((h) => [h.toStatus, h.employeeName]), [['Preparing', 'Elena']]);
  const retry = await placeOrder(second.url, { context: placed.context, attempt: placed.attempt });
  assert.equal(retry.status, 200, 'a pre-restart attempt still recovers its original order');
  assert.equal(retry.data.confirmation.orderNumber, orderNumber);
  assert.ok(fs.existsSync(path.join(env.MESA_DATA_DIR, 'mesa.sqlite')));
  await stopServerProcess(second.child);
});

test('two server processes sharing one database still accept each submission once and reject stale changes', async () => {
  const dataDir = makeDataDir('mesa-multi-');
  const base = { MESA_DATA_DIR: dataDir, MESA_RESTAURANT_FILE: allDayRestaurantFile(dataDir) };
  const a = await startServerProcess({ ...base, MESA_PORT: String(await freePort()) });
  const b = await startServerProcess({ ...base, MESA_PORT: String(await freePort()) });
  const context = uniqueId('ctx');
  const attempt = uniqueId('att');
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => placeOrder(i % 2 ? a.url : b.url, { context, attempt })));
  assert.equal(new Set(responses.map((r) => r.data.confirmation.orderNumber)).size, 1);
  assert.equal(responses.filter((r) => r.status === 201).length, 1);

  const { orderNumber } = responses[0].data.confirmation;
  const credentials = readCredentials(dataDir);
  const luis = await signIn(a.url, 'luis', credentials.luis);
  const elena = await signIn(b.url, 'elena', credentials.elena);
  const changes = await Promise.all([
    api(a.url, `/api/staff/orders/${orderNumber}/status`, { method: 'POST', cookie: luis, body: { revision: 1, target: 'Preparing' } }),
    api(b.url, `/api/staff/orders/${orderNumber}/status`, { method: 'POST', cookie: elena, body: { revision: 1, target: 'Cancelled', reason: 'No gas' } }),
  ]);
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  await stopServerProcess(a.child);
  await stopServerProcess(b.child);
  const db = openDatabase(dataDir);
  assert.equal(counts(db).orders, 1);
  assert.equal(counts(db).statusChanges, 1);
  db.close();
});

test('HTTPS deployments can require Secure session cookies through configuration', async () => {
  const app = await startTestServer({ env: { MESA_SECURE_COOKIES: 'true' } });
  const response = await api(app.url, '/api/staff/session', { method: 'POST', body: { username: 'luis', password: app.credentials.luis } });
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  await app.close();
});

test('invalid runtime settings fail fast with a clear message', () => {
  assert.throws(() => loadConfig({ MESA_PORT: 'eighty' }), /MESA_PORT must be a whole number/);
  assert.throws(() => loadConfig({ MESA_SECURE_COOKIES: 'maybe' }), /MESA_SECURE_COOKIES must be true or false/);
});
