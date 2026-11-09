// Measures the quality targets in context/acceptance.md against a real server process on loopback.
// Pollers mirror the browser's UpdateCoordinator: 2 s between checks, 3 s timeout.
// Results describe this machine only: they are not evidence about real networks or real users.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { runSetup } from '../src/setup.js';
import { openStores } from '../src/store.js';
import { freshDataDir, readCredentials, removeDataDir } from './harness.js';

const POLL_MS = 2000;
const TIMEOUT_MS = 3000;
const CART = [{ itemId: 'M1', quantity: 1, reviewedPrice: 4500 }, { itemId: 'D2', quantity: 2, reviewedPrice: 1000 }];
const id = () => randomBytes(18).toString('base64url');
const json = (body, cookie) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil((p / 100) * values.length) - 1];
const round = (n) => Math.round(n);
function report(name, values, targetMs) {
  const p95 = percentile(values, 95);
  console.log(`${name}: n=${values.length} p50=${round(percentile(values, 50))}ms p95=${round(p95)}ms max=${round(Math.max(...values))}ms (target p95 <= ${targetMs}ms: ${p95 <= targetMs ? 'met locally' : 'NOT met'})`);
}

const dataDir = freshDataDir();
runSetup(dataDir);
const setupStores = openStores(dataDir);
const restaurant = JSON.parse(setupStores.db.prepare('SELECT data FROM restaurant').get().data);
setupStores.db.prepare('UPDATE restaurant SET data = ?').run(JSON.stringify({ ...restaurant, openingHours: Array(7).fill({ open: 0, close: 1440 }) }));
setupStores.close();
const credentials = readCredentials(dataDir);

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const base = `http://127.0.0.1:${port}`;

let server;
const startServer = () => new Promise((resolve, reject) => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.js'], {
    env: { ...process.env, MESA_DATA_DIR: dataDir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.once('data', resolve);
  server.once('error', reject);
});
const stopServer = () => new Promise((resolve) => {
  server.once('exit', resolve);
  server.kill();
});

const post = async (path, body, cookie) => {
  const response = await fetch(base + path, json(body, cookie));
  return { status: response.status, data: await response.json() };
};
const placeOrder = async () => (await post('/api/orders', { context: id(), attempt: id(), selection: CART })).data;
async function signIn(username) {
  const response = await fetch(`${base}/api/staff/signin`, json({ username, password: credentials[username] }));
  return response.headers.get('set-cookie').split(';')[0];
}
const change = (cookie, number, revision, target) => post(`/api/staff/orders/${number}/status`, { revision, target }, cookie);

async function timedLoad(paths, headers) {
  const started = performance.now();
  await Promise.all(paths.map((path) => fetch(base + path, { headers }).then((r) => r.arrayBuffer())));
  return performance.now() - started;
}

async function concurrentLoads(sessions, rounds, load) {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    times.push(...await Promise.all(Array.from({ length: sessions }, load)));
  }
  return times;
}

/** Polls like the browser and resolves when isDone(body) is true; returns ms since t0 was stamped. */
function createPoller(path, cookie) {
  const watchers = new Set();
  let running = true;
  (async () => {
    await sleep(Math.random() * POLL_MS);
    while (running) {
      try {
        const response = await fetch(base + path, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (response.ok) {
          const data = await response.json();
          for (const watcher of [...watchers]) {
            if (watcher.isDone(data)) {
              watchers.delete(watcher);
              watcher.resolve(performance.now());
            }
          }
        }
      } catch { /* same as a failed check in the browser: keep polling */ }
      await sleep(POLL_MS);
    }
  })();
  return {
    waitFor: (isDone) => new Promise((resolve) => watchers.add({ isDone, resolve })),
    stop: () => { running = false; },
  };
}

async function measureMenu() {
  const files = ['/', '/assets/styles.css', '/assets/shared.js', '/assets/customer.js', '/api/menu'];
  report('Menu load, 100 concurrent sessions x 10 rounds', await concurrentLoads(100, 10, () => timedLoad(files)), 2000);
}

async function measureQueue() {
  for (let i = 0; i < 200; i++) await placeOrder();
  const luis = await signIn('luis');
  const cookies = [luis];
  for (let i = 1; i < 10; i++) cookies.push(await signIn(i % 2 ? 'elena' : 'luis'));
  const files = ['/staff', '/assets/styles.css', '/assets/shared.js', '/assets/staff.js'];
  const load = () => timedLoad([...files, '/api/staff/orders?filter=Active'], { cookie: cookies[Math.floor(Math.random() * 10)] });
  report('Queue load, 10 sessions, 200 active orders x 20 rounds', await concurrentLoads(10, 20, load), 2000);

  const pollers = cookies.map((cookie) => createPoller('/api/staff/orders?filter=Active', cookie));
  await sleep(POLL_MS + 200);
  const delays = [];
  for (let i = 0; i < 20; i++) {
    const order = await placeOrder();
    const stamp = performance.now();
    const watch = pollers.map((p) => p.waitFor((data) => data.orders.some((o) => o.number === order.number)));
    const arrivals = await Promise.all(watch);
    delays.push(...arrivals.map((t) => t - stamp));
    const moved = await change(luis, order.number, 1, 'Preparing');
    const movedStamp = performance.now();
    if (moved.status !== 200) throw new Error('status change failed');
    const statusArrivals = await Promise.all(pollers.map((p) => p.waitFor((data) => data.orders.find((o) => o.number === order.number)?.status === 'Preparing')));
    delays.push(...statusArrivals.map((t) => t - movedStamp));
  }
  pollers.forEach((p) => p.stop());
  report('Queue freshness, 10 sessions, new orders and status changes', delays, 5000);
}

async function measureTracking() {
  const luis = await signIn('luis');
  const orders = [];
  for (let i = 0; i < 100; i++) orders.push(await placeOrder());
  const pollers = orders.map((o) => createPoller(`/api${o.trackingPath}`));
  await sleep(POLL_MS + 500);

  const delays = await Promise.all(orders.map(async (order, index) => {
    await sleep(index * 40);
    const response = await change(luis, order.number, 1, 'Preparing');
    const stamp = performance.now();
    if (response.status !== 200) throw new Error('status change failed');
    return (await pollers[index].waitFor((data) => data.status === 'Preparing')) - stamp;
  }));
  report('Tracking freshness, 100 sessions', delays, 5000);

  // Outage: the service goes away, comes back with a newer status, and each page must obtain it.
  await stopServer();
  await sleep(4000);
  const offline = openStores(dataDir);
  offline.db.prepare("UPDATE orders SET status = 'Ready', revision = revision + 1 WHERE number IN (SELECT number FROM orders WHERE status = 'Preparing')").run();
  offline.close();
  const waits = orders.map((_, index) => pollers[index].waitFor((data) => data.status === 'Ready'));
  await startServer();
  const backAt = performance.now();
  const recovered = (await Promise.all(waits)).map((t) => t - backAt);
  pollers.forEach((p) => p.stop());
  report('Tracking recovery, 100 sessions after an outage', recovered, 5000);
}

async function measureSubmissions() {
  const countOrders = () => {
    const stores = openStores(dataDir);
    const { n } = stores.db.prepare('SELECT COUNT(*) AS n FROM orders').get();
    stores.close();
    return n;
  };
  const before = countOrders();
  let expectedOrders = 0;
  let wrong = 0;
  for (let i = 0; i < 100; i++) {
    const context = id();
    const attempt = id();
    const body = { context, attempt, selection: CART };
    if (i % 4 === 0) { // valid
      if ((await post('/api/orders', body)).data.outcome !== 'accepted') wrong += 1;
      expectedOrders += 1;
    } else if (i % 4 === 1) { // repeated and simultaneous
      const results = await Promise.all([post('/api/orders', body), post('/api/orders', body), post('/api/orders', body)]);
      if (new Set(results.map((r) => r.data.number)).size !== 1) wrong += 1;
      expectedOrders += 1;
    } else if (i % 4 === 2) { // response lost: the client gives up after sending, then retries the same attempt
      const controller = new AbortController();
      const lost = fetch(`${base}/api/orders`, { ...json(body), signal: controller.signal }).catch(() => null);
      await sleep(1);
      controller.abort();
      await lost;
      if ((await post('/api/orders', body)).data.outcome !== 'accepted') wrong += 1;
      expectedOrders += 1;
    } else { // rejected, then retried: must stay rejected
      const bad = { ...body, selection: [{ itemId: 'M1', quantity: 1, reviewedPrice: 1 }] };
      const first = await post('/api/orders', bad);
      const second = await post('/api/orders', bad);
      if (first.status !== 422 || second.status !== 422) wrong += 1;
    }
  }
  const created = countOrders() - before;
  console.log(`Submission reliability: 100 cases, ${wrong} wrong outcomes; orders created ${created}, expected ${expectedOrders} (${wrong === 0 && created === expectedOrders ? 'met locally' : 'NOT met'})`);
}

async function measureConflicts() {
  const luis = await signIn('luis');
  const elena = await signIn('elena');
  let correct = 0;
  for (let i = 0; i < 100; i++) {
    const { number } = await placeOrder();
    const results = await Promise.all([change(luis, number, 1, 'Preparing'), change(elena, number, 1, 'Preparing')]);
    const statuses = results.map((r) => r.status).sort();
    const explained = results.find((r) => r.status === 409)?.data.order.status === 'Preparing';
    const retried = (await change(elena, number, 2, 'Ready')).status === 200;
    if (statuses[0] === 200 && statuses[1] === 409 && explained && retried) correct += 1;
  }
  console.log(`Staff consistency: ${correct}/100 pairs gave one success, one explained conflict and a valid deliberate retry (${correct === 100 ? 'met locally' : 'NOT met'})`);
}

async function measureSignInFlood() {
  const times = [];
  const flood = Promise.all(Array.from({ length: 18 }, (_, i) => post('/api/staff/signin', { username: `nobody${i}`, password: 'wrong' })));
  for (let i = 0; i < 40; i++) times.push(await timedLoad(['/api/menu']));
  await flood;
  report('Menu API while sign-in checks run', times, 2000);
}

try {
  await startServer();
  await measureMenu();
  await measureSignInFlood();
  await measureSubmissions();
  await measureConflicts();
  await measureQueue();
  await measureTracking();
} finally {
  await stopServer();
  removeDataDir(dataDir);
}
