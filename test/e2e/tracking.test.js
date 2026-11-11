import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { expect } from 'playwright/test';
import { addDishes, body, closeBrowser, launchBrowser, openCart, orderCount, PHONE, TABLET, withApp } from './support.js';

before(launchBrowser);
after(closeBrowser);

const CART = [{ itemId: 'M1', quantity: 1, reviewedPrice: 4500 }, { itemId: 'D2', quantity: 2, reviewedPrice: 1000 }];
const id = () => randomBytes(18).toString('base64url');

const placeOrder = (app) => fetch(`${app.base}/api/orders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: id(), attempt: id(), selection: CART }),
}).then((r) => r.json());

function setStatus(app, number, status, reason = null) {
  app.db.prepare('UPDATE orders SET status = ?, revision = revision + 1, cancellation_reason = ? WHERE number = ?').run(status, reason, number);
}

const statusName = (page) => page.locator('#status-name');
const warning = (page) => page.getByText(/Updates are unavailable\. This status may be out of date\. Last checked/);

test('C1 a saved link opens its order without login, in a fresh browser', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  await page.goto(app.base + order.trackingPath);
  await expect(statusName(page)).toHaveText('Received');
  const text = await body(page).innerText();
  for (const expected of [`#${order.number}`, 'Chicken casado', 'Iced tea', '₡6,500', 'Mon, Nov 9, 12:00 PM', 'Last checked',
    'Keep this link private. Anyone with it can view this order.']) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!/Luis|Elena/.test(text));
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
}));

test('C1 invalid, missing and guessed links disclose nothing', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  for (const path of [`/track/${order.number}`, '/track/not-a-real-link', '/track/', '/track']) {
    await page.goto(app.base + path);
    await expect(page.getByText("We couldn't open this tracking link. Check the full saved link.")).toBeVisible();
    assert.ok(!(await body(page).innerText()).includes('Chicken casado'), path);
  }
}));

test('C1 a timeout or service failure is not presented as an invalid link, with no invented status or time', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  await page.route('**/api/track/*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"outcome":"service_unavailable"}' }));
  await page.goto(app.base + order.trackingPath);
  await expect(page.getByText('Updates are unavailable.')).toBeVisible();
  const text = await body(page).innerText();
  assert.ok(!text.includes("couldn't open this tracking link"));
  assert.ok(!text.includes('Last checked'));
  assert.ok(!/Received|Preparing|Ready|Collected|Cancelled/.test(text));
  await page.unroute('**/api/track/*');
  await expect(statusName(page)).toHaveText('Received', { timeout: 8000 });
}));

test('C2 an open page updates automatically from staff changes', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  await page.goto(app.base + order.trackingPath);
  await expect(statusName(page)).toHaveText('Received');
  setStatus(app, order.number, 'Preparing');
  await expect(statusName(page)).toHaveText('Preparing', { timeout: 5000 });
}));

test('C2 failure keeps status and time with a warning; recovery gets current status before clearing it', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  await page.goto(app.base + order.trackingPath);
  await expect(statusName(page)).toHaveText('Received');
  const lastCheck = await page.locator('#last-checked').innerText();
  await page.route('**/api/track/*', (route) => route.abort());
  await expect(warning(page)).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('alert')).toContainText(lastCheck);
  await expect(statusName(page)).toHaveText('Received');
  await expect(page.getByText('Last known status')).toBeVisible();

  setStatus(app, order.number, 'Ready');
  await page.unroute('**/api/track/*');
  await expect(statusName(page)).toHaveText('Ready', { timeout: 8000 });
  await expect(warning(page)).toHaveCount(0);
  await expect(page.getByText('Current status')).toBeVisible();
}));

test('C3 each status gives the right next step, and stale warnings stay clear for every status', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  await page.goto(app.base + order.trackingPath);
  const pickup = 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.';
  const expectations = [
    ['Received', 'The restaurant has received your order. It is not ready for pickup yet.', false],
    ['Preparing', 'Your meal is being prepared. It is not ready for pickup yet.', false],
    ['Ready', 'Your order is ready for pickup.', true],
    ['Collected', 'This order has been collected.', false],
  ];
  for (const [status, message, invitesPickup] of expectations) {
    if (status !== 'Received') setStatus(app, order.number, status);
    await expect(statusName(page)).toHaveText(status, { timeout: 5000 });
    await expect(page.getByText(message)).toBeVisible();
    assert.equal((await body(page).innerText()).includes(pickup), invitesPickup, status);
    if (status === 'Ready') {
      await expect(page.getByText(`Show order number #${order.number}.`)).toBeVisible();
      await expect(page.getByText('Mesa Tica pickup counter', { exact: false }).first()).toBeVisible();
      await expect(page.getByText('Pay at collection.', { exact: false }).first()).toBeVisible();
    }
    await page.route('**/api/track/*', (route) => route.abort());
    await expect(warning(page)).toBeVisible({ timeout: 8000 });
    await expect(statusName(page)).toHaveText(status);
    await page.unroute('**/api/track/*');
    await expect(warning(page)).toHaveCount(0, { timeout: 8000 });
  }
}));

test('C3 Cancelled shows the exact reason and labeled demo contact, and the link keeps working', withApp({}, async ({ app, page }) => {
  const order = await placeOrder(app);
  setStatus(app, order.number, 'Cancelled', '<b>Out</b> of chicken & rice');
  await page.goto(app.base + order.trackingPath);
  await expect(statusName(page)).toHaveText('Cancelled');
  await expect(page.getByText('This order was cancelled.')).toBeVisible();
  await expect(page.getByText('<b>Out</b> of chicken & rice')).toBeVisible();
  await expect(page.getByText('demo-contact@example.invalid (Demo contact — not monitored.)')).toBeVisible();
  assert.ok(!(await body(page).innerText()).includes('pay at collection'));
  await page.reload();
  await expect(statusName(page)).toHaveText('Cancelled');
  await page.route('**/api/track/*', (route) => route.abort());
  await expect(warning(page)).toBeVisible({ timeout: 8000 });
  await expect(statusName(page)).toHaveText('Cancelled');
  await expect(page.getByText('<b>Out</b> of chicken & rice')).toBeVisible();
}));

test('RUN the whole journey in one go: order on a phone, manage on a tablet, track live', withApp({}, async ({ app, page, context }) => {
  await addDishes(page, app, [['Chicken casado'], ['Horchata', 2]]);
  await openCart(page);
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await page.getByRole('heading', { name: 'Order received' }).waitFor();
  await page.getByRole('link', { name: 'View progress' }).click();
  await expect(statusName(page)).toHaveText('Received');

  const staffContext = await context.browser().newContext({ viewport: TABLET });
  const staff = await staffContext.newPage();
  try {
    await staff.goto(`${app.base}/staff`);
    await staff.getByLabel('Username').fill('elena');
    await staff.getByLabel('Password').fill(app.credentials.elena);
    await staff.getByRole('button', { name: 'Sign in' }).click();
    await staff.locator('#order-1001').click();
    for (const [button, status] of [['Mark Preparing', 'Preparing'], ['Mark Ready', 'Ready'], ['Mark Collected', 'Collected']]) {
      await staff.getByRole('button', { name: button }).click();
      await expect(staff.locator('#detail-body .status-pill')).toHaveText(status);
      await expect(statusName(page)).toHaveText(status, { timeout: 5000 });
    }
    assert.equal(orderCount(app), 1);
  } finally {
    await staffContext.close();
  }
}));

test('EXPERIENCE tracking fits a phone without sideways scrolling', withApp({ viewport: PHONE }, async ({ app, page }) => {
  const order = await placeOrder(app);
  setStatus(app, order.number, 'Ready');
  await page.goto(app.base + order.trackingPath);
  await expect(statusName(page)).toHaveText('Ready');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
}));
