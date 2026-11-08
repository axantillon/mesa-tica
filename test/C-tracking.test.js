import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, tokenOf } from './helpers.js';
import { Poller, finalError } from '../shared/Poller.js';

const INSTRUCTIONS = 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.';
const CONTACT = 'demo-contact@example.invalid (Demo contact, not monitored)';

test('C1 open tracking link', async (t) => {
  const app = await startApp(t);
  const placed = (await app.place()).body;
  const token = tokenOf(placed);
  const luis = await app.signIn('luis');
  await app.changeStatus(luis, placed.number, 1, 'Preparing');

  await t.test('valid token: number and items, no staff names', async () => {
    const res = await app.call('GET', `/api/track/${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      number: placed.number, status: 'Preparing', submittedAt: placed.submittedAt, total: 7900, lines: placed.lines,
    });
    for (const secret of ['luis', 'Luis', 'elena', 'employeeId', 'statusChanges', 'submissionId', 'trackingToken', 'version']) {
      assert.ok(!res.text.includes(secret), secret);
    }
  });

  await t.test('missing or unknown token, or an order number: 404, no data', async () => {
    const other = (await app.place()).body;
    for (const path of ['/api/track/', '/api/track', `/api/track/${placed.number}`, `/api/track/${other.number}`, '/api/track/AAAAAAAAAAAAAAAAAAAAAA', `/api/track/${token.slice(0, -1)}`, `/api/track/${token}x`]) {
      const res = await app.call('GET', path);
      assert.equal(res.status, 404, path);
      assert.deepEqual(res.body, { reason: 'not_found' }, path);
    }
  });

  await t.test('the link opens the tracking page directly', async () => {
    const page = await app.call('GET', placed.trackingLink);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(page.text, /TrackingPage\.js/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  });
});

test('C2 follow status', async (t) => {
  const app = await startApp(t);
  const placed = (await app.place()).body;
  const token = tokenOf(placed);
  const luis = await app.signIn('luis');
  const track = async () => (await app.call('GET', `/api/track/${token}`)).body.status;

  await t.test('a staff change shows on the next getTracking', async () => {
    assert.equal(await track(), 'Received');
    let version = 1;
    for (const to of ['Preparing', 'Ready', 'Collected']) {
      await app.changeStatus(luis, placed.number, version++, to);
      assert.equal(await track(), to);
    }
  });

  await t.test('polling state: a failure keeps the last status and warns; only a success clears it', async () => {
    let offline = false;
    const poller = new Poller(async () => {
      if (offline) throw new TypeError('fetch failed');
      const res = await app.call('GET', `/api/track/${token}`);
      if (res.status === 404) throw finalError(404);
      return res.body;
    }, { timeout: 1000 });
    await poller.tick();
    assert.equal(poller.data.status, 'Collected');
    assert.equal(poller.warning, false);
    const lastCheck = poller.lastSuccess;
    offline = true;
    await poller.tick();
    assert.deepEqual([poller.data.status, poller.warning, poller.lastSuccess], ['Collected', true, lastCheck]);
    await poller.tick();
    assert.equal(poller.warning, true);
    offline = false;
    await poller.tick();
    assert.equal(poller.warning, false);
    assert.ok(poller.lastSuccess >= lastCheck);
  });

  await t.test('an unknown link stops polling', async () => {
    const poller = new Poller(async () => {
      const res = await app.call('GET', '/api/track/nope');
      if (res.status === 404) throw finalError(404);
      return res.body;
    });
    await poller.start(() => {});
    assert.deepEqual([poller.stopped, poller.stopReason.status, poller.data], [true, 404, null]);
  });
});

test('C3 ready or cancelled', async (t) => {
  const app = await startApp(t);
  const luis = await app.signIn('luis');
  const placed = (await app.place()).body;
  const track = async (o) => (await app.call('GET', `/api/track/${tokenOf(o)}`)).body;
  const noExtras = (body) => {
    for (const key of ['collectionInstructions', 'cancellationReason', 'contact']) assert.ok(!(key in body), key);
  };

  await t.test('Received and Preparing: no instructions', async () => {
    noExtras(await track(placed));
    await app.changeStatus(luis, placed.number, 1, 'Preparing');
    const preparing = await track(placed);
    assert.equal(preparing.status, 'Preparing');
    noExtras(preparing);
  });

  await t.test('Ready: collection instructions and the order number', async () => {
    await app.changeStatus(luis, placed.number, 2, 'Ready');
    const ready = await track(placed);
    assert.equal(ready.status, 'Ready');
    assert.equal(ready.number, placed.number);
    assert.equal(ready.collectionInstructions, INSTRUCTIONS);
    assert.ok(!('contact' in ready));
  });

  await t.test('Collected: nothing left to do', async () => {
    await app.changeStatus(luis, placed.number, 3, 'Collected');
    noExtras(await track(placed));
  });

  await t.test('Cancelled: the staff reason and the restaurant contact', async () => {
    const other = (await app.place()).body;
    await app.changeStatus(luis, other.number, 1, 'Cancelled', 'We ran out of chicken.');
    const cancelled = await track(other);
    assert.equal(cancelled.status, 'Cancelled');
    assert.equal(cancelled.cancellationReason, 'We ran out of chicken.');
    assert.equal(cancelled.contact, CONTACT);
    assert.ok(!('collectionInstructions' in cancelled));
  });
});
