import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { TIMES, WORKED_SELECTION, api, placeOrder, startTestServer, uniqueId } from '../support/harness.js';

let app;
before(async () => {
  app = await startTestServer();
});
after(() => app.close());
beforeEach(() => {
  app.clock.set(TIMES.open);
  app.setMenuItem('M1', { price: 4500, available: true });
  app.setMenuItem('S2', { price: 1400, available: true });
});

describe('A3 reviewed acceptance', () => {
  test('a valid guest order needs no personal data and creates one Received order', async () => {
    const before = app.counts();
    const response = await placeOrder(app.url);
    assert.equal(response.status, 201);
    const { confirmation } = response.data;
    assert.equal(confirmation.status, 'Received');
    assert.equal(confirmation.total, 7900);
    assert.deepEqual(
      confirmation.items.map(({ name, quantity, subtotal }) => [name, quantity, subtotal]),
      [
        ['Chicken casado', 1, 4500],
        ['Cheese empanada', 1, 1400],
        ['Iced tea', 2, 2000],
      ],
    );
    assert.match(confirmation.trackingPath, /^\/track\/[A-Za-z0-9_-]{32}$/);
    assert.equal(app.counts().orders, before.orders + 1);
    const stored = app.db.prepare('SELECT status, total FROM orders WHERE number = ?').get(confirmation.orderNumber);
    assert.deepEqual({ ...stored }, { status: 'Received', total: 7900 });
  });

  test('private links carry at least 128 bits of randomness and are unique', async () => {
    const tokens = new Set();
    for (let i = 0; i < 20; i += 1) {
      const { data } = await placeOrder(app.url);
      const token = data.confirmation.trackingPath.split('/').pop();
      assert.equal(Buffer.from(token, 'base64url').length * 8 >= 128, true);
      tokens.add(token);
    }
    assert.equal(tokens.size, 20);
  });

  test('empty and invalid selections are rejected without creating anything', async () => {
    const before = app.counts();
    const invalid = [
      [],
      [{ code: 'M1', quantity: 0, reviewedPrice: 4500 }],
      [{ code: 'M1', quantity: -1, reviewedPrice: 4500 }],
      [{ code: 'M1', quantity: 1.5, reviewedPrice: 4500 }],
      [{ code: 'M1', quantity: '2', reviewedPrice: 4500 }],
      [{ code: 'M1', quantity: 100, reviewedPrice: 4500 }],
      [
        { code: 'M1', quantity: 1, reviewedPrice: 4500 },
        { code: 'M1', quantity: 1, reviewedPrice: 4500 },
      ],
    ];
    for (const selection of invalid) {
      const response = await placeOrder(app.url, { selection });
      assert.equal(response.status, 400, JSON.stringify(selection));
    }
    assert.deepEqual(app.counts(), before);
  });

  test('closed ordering is rejected with the next opening and no order', async () => {
    app.clock.set(TIMES.closingInstant);
    const before = app.counts();
    const response = await placeOrder(app.url);
    assert.equal(response.status, 422);
    assert.equal(response.data.outcome, 'rejected');
    assert.equal(response.data.correction.message, 'Ordering is closed. Opens Wednesday, November 11 at 10:00 AM (Costa Rica time).');
    assert.equal(app.counts().orders, before.orders);
  });

  test('opening time is inclusive and closing exclusive for submissions', async () => {
    app.clock.set(TIMES.beforeOpening);
    assert.equal((await placeOrder(app.url)).status, 422);
    app.clock.set(TIMES.openingInstant);
    assert.equal((await placeOrder(app.url)).status, 201);
    app.clock.set(TIMES.lastOpenSecond);
    assert.equal((await placeOrder(app.url)).status, 201);
  });

  test('an empty weekly schedule rejects with contact guidance and no reopening time', async () => {
    const original = JSON.parse(app.db.prepare('SELECT details FROM restaurant').get().details).weeklyHours;
    app.setWeeklyHours({});
    try {
      const menu = await api(app.url, '/api/menu');
      assert.equal(menu.data.ordering.acceptingOrders, false);
      assert.equal(menu.data.ordering.nextOpening, null);
      assert.match(menu.data.ordering.message, /currently closed.*demo-contact@example\.invalid \(Demo contact — not monitored\)/);
      const response = await placeOrder(app.url);
      assert.equal(response.status, 422);
      assert.equal(response.data.correction.closed.nextOpening, null);
    } finally {
      app.setWeeklyHours(original);
    }
  });

  test('a price change in either direction requires review; the corrected resubmission is a new attempt', async () => {
    for (const price of [4600, 4400]) {
      app.setMenuItem('M1', { price });
      const before = app.counts();
      const rejected = await placeOrder(app.url);
      assert.equal(rejected.status, 422);
      assert.deepEqual(rejected.data.correction.items, [
        {
          code: 'M1',
          kind: 'priceChanged',
          name: 'Chicken casado',
          currentPrice: price,
          message: `Chicken casado is now ₡${price.toLocaleString('en-US')}. Review your updated total before placing the order.`,
        },
      ]);
      assert.equal(app.counts().orders, before.orders);

      const reviewed = WORKED_SELECTION.map((line) => (line.code === 'M1' ? { ...line, reviewedPrice: price } : line));
      const accepted = await placeOrder(app.url, { context: rejected.context, selection: reviewed });
      assert.equal(accepted.status, 201);
      assert.equal(accepted.data.confirmation.total, 7900 - 4500 + price);
    }
  });

  test('an unavailable or removed dish is identified and never substituted', async () => {
    app.setMenuItem('S2', { available: false });
    const response = await placeOrder(app.url, {
      selection: [...WORKED_SELECTION, { code: 'ZZ9', quantity: 1, reviewedPrice: 100 }],
    });
    assert.equal(response.status, 422);
    assert.deepEqual(
      response.data.correction.items.map(({ code, kind }) => [code, kind]),
      [
        ['S2', 'unavailable'],
        ['ZZ9', 'unavailable'],
      ],
    );
    assert.match(response.data.correction.items[0].message, /^Cheese empanada is no longer available\. Remove it or choose another item\.$/);
  });

  test('Fish casado cannot be ordered while unavailable', async () => {
    const response = await placeOrder(app.url, { selection: [{ code: 'M3', quantity: 1, reviewedPrice: 5000 }] });
    assert.equal(response.status, 422);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM order_items WHERE item_code = 'M3'").get().n, 0);
  });
});

describe('A4 submission recovery', () => {
  test('repeating an accepted attempt returns the same order without a duplicate', async () => {
    const first = await placeOrder(app.url);
    const before = app.counts();
    const again = await placeOrder(app.url, { context: first.context, attempt: first.attempt });
    assert.equal(again.status, 200);
    assert.equal(again.data.created, false);
    assert.equal(again.data.confirmation.orderNumber, first.data.confirmation.orderNumber);
    assert.equal(again.data.confirmation.trackingPath, first.data.confirmation.trackingPath, 'the private link is never regenerated');
    assert.deepEqual(app.counts(), before);
  });

  test('simultaneous attempts for one submission create exactly one order', async () => {
    const context = uniqueId('ctx');
    const attempt = uniqueId('att');
    const before = app.counts();
    const responses = await Promise.all(Array.from({ length: 25 }, () => placeOrder(app.url, { context, attempt })));
    const numbers = new Set(responses.map((response) => response.data.confirmation.orderNumber));
    assert.equal(numbers.size, 1);
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.equal(app.counts().orders, before.orders + 1);
  });

  test('a retry of an accepted attempt succeeds after closing and after a menu change', async () => {
    const first = await placeOrder(app.url);
    app.clock.set(TIMES.closingInstant);
    app.setMenuItem('M1', { price: 9999, available: false });
    const retry = await placeOrder(app.url, { context: first.context, attempt: first.attempt });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.confirmation.orderNumber, first.data.confirmation.orderNumber);
    assert.equal(retry.data.confirmation.total, 7900, 'accepted values are not rebuilt from the changed menu');
    const recovered = await api(app.url, '/api/orders/recover', { method: 'POST', body: { context: first.context, attempt: first.attempt } });
    assert.equal(recovered.data.outcome, 'accepted');
    assert.equal(recovered.data.confirmation.orderNumber, first.data.confirmation.orderNumber);
  });

  test('a recorded rejection is returned by recovery and never turns into an order', async () => {
    app.clock.set(TIMES.closingInstant);
    const rejected = await placeOrder(app.url);
    assert.equal(rejected.status, 422);
    app.clock.set(TIMES.open);
    const before = app.counts();

    const check = await api(app.url, '/api/orders/recover', { method: 'POST', body: { context: rejected.context, attempt: rejected.attempt } });
    assert.equal(check.status, 200);
    assert.equal(check.data.outcome, 'rejected');
    assert.deepEqual(check.data.correction, rejected.data.correction, 'recovery returns the original correction');

    const retry = await placeOrder(app.url, { context: rejected.context, attempt: rejected.attempt });
    assert.equal(retry.status, 422, 'the closed attempt stays closed even though ordering is now open');
    assert.deepEqual(app.counts(), before);
  });

  test('an unknown attempt stays unresolved, and recovery is scoped to the customer context', async () => {
    const unknown = await api(app.url, '/api/orders/recover', { method: 'POST', body: { context: uniqueId('ctx'), attempt: uniqueId('att') } });
    assert.deepEqual(unknown.data, { outcome: 'unresolved' });

    const mine = await placeOrder(app.url);
    const otherContext = await api(app.url, '/api/orders/recover', { method: 'POST', body: { context: uniqueId('ctx'), attempt: mine.attempt } });
    assert.deepEqual(otherContext.data, { outcome: 'unresolved' }, "another customer's context reveals nothing");

    const before = app.counts();
    const sameAttemptOtherContext = await placeOrder(app.url, { attempt: mine.attempt });
    assert.equal(sameAttemptOtherContext.status, 201);
    assert.notEqual(sameAttemptOtherContext.data.confirmation.orderNumber, mine.data.confirmation.orderNumber);
    assert.equal(app.counts().orders, before.orders + 1);
  });

  test('a changed selection under an accepted attempt is not ordered', async () => {
    const first = await placeOrder(app.url);
    const before = app.counts();
    const changed = await placeOrder(app.url, {
      context: first.context,
      attempt: first.attempt,
      selection: [{ code: 'M2', quantity: 3, reviewedPrice: 4000 }],
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.differentSelection, true);
    assert.equal(changed.data.confirmation.total, 7900);
    assert.deepEqual(app.counts(), before);
  });

  test('a deliberate new order from the same browser is separate', async () => {
    const first = await placeOrder(app.url);
    const second = await placeOrder(app.url, { context: first.context });
    assert.equal(second.status, 201);
    assert.notEqual(second.data.confirmation.orderNumber, first.data.confirmation.orderNumber);
  });
});

describe('Q-SUBMISSION local reliability run', () => {
  test('100 mixed cases preserve exactly one order per accepted submission and none per rejected one', async () => {
    const before = app.counts();
    const accepted = new Map();
    let rejectedCount = 0;
    for (let i = 0; i < 100; i += 1) {
      const kind = ['valid', 'repeated', 'lostResponse', 'rejectedClosed', 'rejectedPrice'][i % 5];
      app.clock.set(kind === 'rejectedClosed' ? TIMES.closingInstant : TIMES.open);
      const selection = kind === 'rejectedPrice' ? [{ code: 'M1', quantity: 1, reviewedPrice: 4000 }] : WORKED_SELECTION;
      const first = await placeOrder(app.url, { selection });
      if (kind === 'repeated') {
        await Promise.all([placeOrder(app.url, { ...first, selection }), placeOrder(app.url, { ...first, selection })]);
      }
      if (kind === 'lostResponse') {
        // The first response is treated as lost: the browser checks, then retries the same attempt.
        const check = await api(app.url, '/api/orders/recover', { method: 'POST', body: { context: first.context, attempt: first.attempt } });
        assert.equal(check.data.outcome, 'accepted');
        await placeOrder(app.url, { ...first, selection });
      }
      if (first.status === 201) accepted.set(first.attempt, first.data.confirmation.orderNumber);
      else {
        assert.equal(first.status, 422);
        rejectedCount += 1;
        const retry = await placeOrder(app.url, { ...first, selection });
        assert.equal(retry.status, 422);
      }
    }
    assert.equal(accepted.size, 60);
    assert.equal(rejectedCount, 40);
    assert.equal(app.counts().orders, before.orders + 60);
    const rows = app.db
      .prepare("SELECT attempt_id, order_number FROM submission_attempts WHERE outcome = 'accepted' AND order_number IS NOT NULL")
      .all();
    const byAttempt = new Map(rows.map((row) => [row.attempt_id, row.order_number]));
    for (const [attempt, number] of accepted) assert.equal(byAttempt.get(attempt), number);
  });
});
