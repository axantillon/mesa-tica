import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { api, placeOrder, signIn, startTestServer, uniqueId } from '../support/harness.js';

let app;
let cookie;
let order;

before(async () => {
  app = await startTestServer();
  cookie = await signIn(app.url, 'luis', app.credentials.luis);
  order = (await placeOrder(app.url)).data.confirmation;
});
after(() => app.close());

const JSON_BODY_ENDPOINTS = () => [
  ['/api/orders', {}],
  ['/api/orders/recover', {}],
  ['/api/staff/session', {}],
  [`/api/staff/orders/${order.orderNumber}/status`, { cookie }],
];

test('malformed JSON is HTTP 400 on every JSON body endpoint, with no writes and no protected data', async () => {
  const before = app.counts();
  for (const [route, options] of JSON_BODY_ENDPOINTS()) {
    for (const rawBody of ['{"context": ', 'not json', '']) {
      const response = await api(app.url, route, { method: 'POST', rawBody, ...options });
      assert.equal(response.status, 400, `${route} ${JSON.stringify(rawBody)}`);
      assert.equal(response.data.error, 'malformed_json');
      assert.equal(JSON.stringify(response.data).includes('Chicken'), false);
    }
  }
  assert.deepEqual(app.counts(), before);
});

test('unsupported media types are HTTP 415 on JSON-only endpoints', async () => {
  const before = app.counts();
  for (const [route, options] of JSON_BODY_ENDPOINTS()) {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const response = await api(app.url, route, { method: 'POST', rawBody: '{"a":1}', contentType, ...options });
      assert.equal(response.status, 415, `${route} ${contentType}`);
    }
    const missing = await fetch(app.url + route, { method: 'POST', body: '{}', headers: { 'Content-Type': '' } });
    assert.equal(missing.status, 415);
  }
  assert.deepEqual(app.counts(), before);
});

test('valid JSON with invalid values is HTTP 400, never 500', async () => {
  const before = app.counts();
  const cases = [
    ['/api/orders', [], {}],
    ['/api/orders', null, {}],
    ['/api/orders', { context: 'short', attempt: uniqueId(), selection: [] }, {}],
    ['/api/orders', { context: uniqueId(), attempt: uniqueId(), selection: 'M1' }, {}],
    ['/api/orders/recover', { context: uniqueId() }, {}],
    ['/api/staff/session', { username: 42, password: 'x' }, {}],
    [`/api/staff/orders/${order.orderNumber}/status`, { revision: '1', target: 'Preparing' }, { cookie }],
    [`/api/staff/orders/${order.orderNumber}/status`, { revision: 1, target: 'Shipped' }, { cookie }],
    [`/api/staff/orders/${order.orderNumber}/status`, { revision: 1, target: 'Cancelled', reason: 7 }, { cookie }],
    ['/api/staff/orders/abc/status', { revision: 1, target: 'Preparing' }, { cookie }],
  ];
  for (const [route, body, options] of cases) {
    const response = await api(app.url, route, { method: 'POST', body, ...options });
    assert.equal(response.status, 400, `${route} ${JSON.stringify(body)}`);
  }
  assert.deepEqual(app.counts(), before);
});

test('an unknown queue filter on an authorized request is HTTP 400; unauthorized requests stay 401', async () => {
  for (const filter of ['Unknown', 'active', '', 'Active%20OR%201']) {
    const response = await api(app.url, `/api/staff/orders?filter=${filter}`, { cookie });
    assert.equal(response.status, 400, filter);
    assert.equal(response.data.orders, undefined);
  }
  assert.equal((await api(app.url, '/api/staff/orders?filter=Unknown')).status, 401);
});

test('errors expose no traces, credentials or private links; ordinary requests still work', async () => {
  const responses = [
    await api(app.url, '/api/orders', { method: 'POST', rawBody: '{' }),
    await api(app.url, '/api/staff/session', { method: 'POST', body: { username: 'luis', password: 'bad' } }),
    await api(app.url, '/api/staff/orders/1', { method: 'DELETE', cookie }),
    await api(app.url, '/api/nope'),
  ];
  assert.deepEqual(responses.map((r) => r.status), [400, 401, 405, 404]);
  const token = order.trackingPath.split('/').pop();
  for (const response of responses) {
    const text = JSON.stringify(response.data);
    assert.equal(/at \S+\.js:\d+|Error:|stack/.test(text), false);
    assert.equal(text.includes(app.credentials.luis), false);
    assert.equal(text.includes(token), false);
  }
  assert.equal((await placeOrder(app.url)).status, 201);
  assert.equal((await api(app.url, '/api/staff/orders', { cookie })).status, 200);
});

test('oversized bodies are rejected without writes', async () => {
  const before = app.counts();
  const response = await api(app.url, '/api/orders', { method: 'POST', rawBody: JSON.stringify({ pad: 'x'.repeat(20000) }) });
  assert.equal(response.status, 413);
  assert.deepEqual(app.counts(), before);
});
