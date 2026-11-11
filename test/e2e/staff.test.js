import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { expect } from 'playwright/test';
import { body, closeBrowser, launchBrowser, PHONE, TABLET, withApp } from './support.js';

before(launchBrowser);
after(closeBrowser);

const tablet = { viewport: TABLET };
const CART = [{ itemId: 'M1', quantity: 1, reviewedPrice: 4500 }, { itemId: 'D2', quantity: 2, reviewedPrice: 1000 }];
const id = () => randomBytes(18).toString('base64url');
const post = (base, path, payload) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((r) => r.json());
const placeOrder = (app) => post(app.base, '/api/orders', { context: id(), attempt: id(), selection: CART });
const mark = (app, number, revision, target, employee, reason = null) => app.db.exec(`BEGIN;
  UPDATE orders SET status = '${target}', revision = ${revision + 1}, cancellation_reason = ${reason ? `'${reason}'` : 'NULL'} WHERE number = ${number};
  INSERT INTO status_changes (order_number, from_status, to_status, employee_id, at, reason)
    SELECT ${number}, 'Received', '${target}', '${employee}', ${Date.now()}, NULL;
  COMMIT;`);

async function signIn(page, app, name = 'luis') {
  await page.goto(`${app.base}/staff`);
  await page.getByLabel('Username').fill(name);
  await page.getByLabel('Password').fill(app.credentials[name]);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
}

const openOrder = (page, number) => page.locator(`#order-${number}`).click();
const statusPill = (page) => page.locator('#detail-body .status-pill');

test('B1 sign-in errors are generic, and a connection failure is not blamed on credentials', withApp(tablet, async ({ app, page }) => {
  await page.goto(`${app.base}/staff`);
  await page.getByLabel('Username').fill('luis');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("We couldn't sign you in. Check your credentials and try again.")).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveValue('luis');
  await expect(page.getByLabel('Password')).toHaveValue('');
  await page.route('**/api/staff/signin', (route) => route.abort());
  await page.getByLabel('Password').fill('anything');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("We couldn't reach sign-in. Your credentials were not rejected.")).toBeVisible();
}));

test('B1 default Active queue is oldest first, filters work and empty states differ', withApp(tablet, async ({ app, page }) => {
  await signIn(page, app);
  await expect(page.getByText('No active orders.')).toBeVisible();
  await expect(page.locator('#last-refresh')).toContainText('Last refreshed');
  const first = await placeOrder(app);
  app.clock.t += 60_000;
  const second = await placeOrder(app);
  await expect(page.locator('.queue-number')).toHaveText([`#${first.number}`, `#${second.number}`]);
  await expect(page.locator(`#order-${first.number}`)).toContainText('1 × Chicken casado, 2 × Iced tea');
  await page.getByRole('link', { name: 'Ready', exact: true }).click();
  await expect(page.getByText('No orders match this filter.')).toBeVisible();
  for (const filter of ['Received', 'All']) {
    await page.getByRole('link', { name: filter, exact: true }).click();
    await expect(page.locator('.queue-number')).toHaveCount(2);
  }
  for (const filter of ['Preparing', 'Collected', 'Cancelled']) {
    await page.getByRole('link', { name: filter, exact: true }).click();
    await expect(page.getByText('No orders match this filter.')).toBeVisible();
  }
  await page.getByRole('link', { name: 'Active', exact: true }).click();
  await expect(page.locator('.queue-number')).toHaveCount(2);
}));

test('B1 new orders and another employee\'s changes appear automatically and the filter is preserved', withApp(tablet, async ({ app, page }) => {
  await signIn(page, app);
  const order = await placeOrder(app);
  await expect(page.locator(`#order-${order.number}`)).toBeVisible();
  await page.getByRole('link', { name: 'Received', exact: true }).click();
  await expect(page.locator(`#order-${order.number}`)).toBeVisible();
  mark(app, order.number, 1, 'Preparing', 'elena');
  await expect(page.getByText('No orders match this filter.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Received', exact: true })).toHaveAttribute('aria-current', 'page');
}));

test('B1 returning from detail preserves the filter', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await page.getByRole('link', { name: 'Received', exact: true }).click();
  await openOrder(page, order.number);
  await page.getByRole('heading', { name: `Order #${order.number}` }).waitFor();
  await page.getByRole('link', { name: '← Back to Received orders' }).click();
  await expect(page.getByRole('link', { name: 'Received', exact: true })).toHaveAttribute('aria-current', 'page');
}));

test('B1-STALE a refresh failure keeps data and time, and recovery clears the warning only with current data', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await expect(page.locator(`#order-${order.number}`)).toBeVisible();
  const lastGood = (await page.locator('#last-refresh').innerText()).replace('Last refreshed ', '');
  await page.route('**/api/staff/orders*', (route) => route.abort());
  await expect(page.getByText(/Updates are unavailable\. This information may be out of date\. Last refreshed/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('alert')).toContainText(`Last refreshed ${lastGood}`);
  await expect(page.locator(`#order-${order.number}`)).toBeVisible();

  const second = await placeOrder(app);
  await page.unroute('**/api/staff/orders*');
  await expect(page.locator(`#order-${second.number}`)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Updates are unavailable/)).toHaveCount(0);
}));

test('B1 a first-load failure is distinct from an empty queue', withApp(tablet, async ({ app, page }) => {
  await signIn(page, app);
  await page.route('**/api/staff/orders*', (route) => route.abort());
  await page.getByRole('link', { name: 'Ready', exact: true }).click();
  await expect(page.getByText("We couldn't load orders. We'll keep trying.")).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('No orders match this filter.')).toHaveCount(0);
  await expect(page.locator('#last-refresh')).toHaveCount(0);
}));

test('B1-STALE expired access requires sign-in and shows no order data; a typed reason returns with it', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByLabel('Reason for cancelling').fill('Out of plantain');
  app.db.exec('DELETE FROM sessions');
  await expect(page.getByText('Your session has expired. Sign in to continue.')).toBeVisible({ timeout: 8000 });
  assert.ok(!(await body(page).innerText()).includes('Chicken casado'));
  await page.getByLabel('Username').fill('luis');
  await page.getByLabel('Password').fill(app.credentials.luis);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Out of plantain');
}));

test('B1 sign-out ends access and shows no order data; unconfirmed sign-out says so', withApp(tablet, async ({ app, page }) => {
  await placeOrder(app);
  await signIn(page, app);
  await page.route('**/api/staff/signout', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign-out was not confirmed. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('You have signed out.')).toBeVisible();
  assert.ok(!(await body(page).innerText()).includes('#1001'));
  await page.reload();
  await expect(page.getByLabel('Username')).toBeVisible();
}));

test('B2 detail shows accepted values, time, status and history after a menu change', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  app.setPrice('M1', 9999);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('heading', { name: `Order #${order.number}` }).waitFor();
  const text = await body(page).innerText();
  for (const expected of ['Chicken casado', '₡4,500', '₡6,500', 'Iced tea', 'Mon, Nov 9, 12:00 PM', 'No staff changes yet.']) assert.ok(text.includes(expected), expected);
  await page.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(page.getByText('Received → Preparing')).toBeVisible();
  await expect(page.locator('.history')).toContainText('by Luis');
}));

test('B3 the only actions offered follow the lifecycle, through to Collected', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  const actions = () => page.locator('#detail-actions button').allInnerTexts();
  await page.getByRole('button', { name: 'Mark Preparing' }).waitFor();
  assert.deepEqual(await actions(), ['Mark Preparing', 'Cancel order']);
  await page.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(statusPill(page)).toHaveText('Preparing');
  await expect(page.getByText('Order marked Preparing.')).toBeVisible();
  assert.deepEqual(await actions(), ['Mark Ready', 'Cancel order']);
  await page.getByRole('button', { name: 'Mark Ready' }).click();
  await expect(statusPill(page)).toHaveText('Ready');
  assert.deepEqual(await actions(), ['Mark Collected', 'Cancel order']);
  await page.getByRole('button', { name: 'Mark Collected' }).click();
  await expect(statusPill(page)).toHaveText('Collected');
  assert.deepEqual(await actions(), []);
  await page.getByRole('link', { name: /Back to Active/ }).click();
  await expect(page.getByText('No active orders.')).toBeVisible();
}));

test('B3 cancel needs a nonblank reason and final confirmation; dismissing changes nothing and keeps the reason', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText("The customer will see this reason. Explain why")).toBeVisible();
  await page.getByLabel('Reason for cancelling').fill('    ');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  await expect(page.getByText('Enter the reason the customer will see.')).toBeVisible();
  await page.getByLabel('Reason for cancelling').fill('Out of chicken today');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  await expect(page.getByRole('dialog')).toContainText(`Cancel order #${order.number}?`);
  await expect(page.getByRole('dialog')).toContainText('The customer will see this reason.');
  await expect(page.getByRole('dialog')).toContainText('Out of chicken today');
  await page.getByRole('dialog').getByRole('button', { name: 'Keep order' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(statusPill(page)).toHaveText('Received');
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Out of chicken today');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Out of chicken today');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(statusPill(page)).toHaveText('Cancelled');
  await expect(page.getByText('Cancellation reason: Out of chicken today')).toBeVisible();
  await expect(page.locator('#detail-actions button')).toHaveCount(0);
  const tracked = await app.db.prepare('SELECT status FROM orders').get();
  assert.equal(tracked.status, 'Cancelled');
}));

test('B3-CONFLICT two employees: one wins, the other sees the explained conflict and acts deliberately', withApp(tablet, async ({ app, page, context }) => {
  const order = await placeOrder(app);
  const other = await context.browser().newContext({ viewport: TABLET });
  const elena = await other.newPage();
  try {
    await signIn(page, app, 'luis');
    await signIn(elena, app, 'elena');
    await openOrder(page, order.number);
    await openOrder(elena, order.number);
    await page.getByRole('button', { name: 'Mark Preparing' }).waitFor();
    await elena.getByRole('button', { name: 'Mark Preparing' }).waitFor();
    // Both employees see revision 1; hold Luis's request until Elena's has been accepted.
    await page.route('**/status', async (route) => {
      await elena.getByRole('button', { name: 'Mark Preparing' }).click();
      await expect(statusPill(elena)).toHaveText('Preparing');
      await route.continue();
    }, { times: 1 });
    await page.getByRole('button', { name: 'Mark Preparing' }).click();
    await expect(page.getByText('This order changed before your update was saved. It is now Preparing.')).toBeVisible();
    await expect(statusPill(page)).toHaveText('Preparing');
    await expect(page.locator('.history')).toContainText('by Elena');
    await expect(page.locator('.history li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Mark Ready' }).click();
    await expect(statusPill(page)).toHaveText('Ready');
    await expect(page.locator('.history li')).toHaveCount(2);
  } finally {
    await other.close();
  }
}));

test('B3-CONFLICT refresh during confirmation keeps the chosen revision, and a new choice is deliberate', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByLabel('Reason for cancelling').fill('Out of rice');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  mark(app, order.number, 1, 'Preparing', 'elena'); // another employee acts while the dialog is open
  await expect(statusPill(page)).toHaveText('Preparing', { timeout: 8000 }); // the background refresh has landed
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('This order changed before your update was saved. It is now Preparing.')).toBeVisible();
  assert.equal(app.db.prepare('SELECT status FROM orders').get().status, 'Preparing');
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Out of rice');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(statusPill(page)).toHaveText('Cancelled');
}));

test('B3 an uncertain write is never repeated; actual state is shown and the reason is kept', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Mark Preparing' }).waitFor();
  let writes = 0;
  await page.route('**/status', async (route) => {
    writes += 1;
    await route.fetch(); // the server applies it; the response is lost
    await route.abort();
  });
  await page.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(page.getByText("We couldn't confirm whether that change was saved. The current status is shown below.")).toBeVisible();
  await expect(statusPill(page)).toHaveText('Preparing');
  await expect(page.getByText('Order marked Preparing.')).toHaveCount(0);
  await page.waitForTimeout(2500);
  assert.equal(writes, 1, 'not resubmitted');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM status_changes').get().n, 1);
}));

test('B3 a stale detail blocks actions until refreshed and keeps a typed reason', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByLabel('Reason for cancelling').fill('Kitchen fire drill');
  await page.getByRole('button', { name: 'Review cancellation' }).focus();
  await page.route(`**/api/staff/orders/${order.number}`, (route) => route.abort());
  await expect(page.getByText(/This information may be out of date/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Refresh before acting.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Preparing' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review cancellation' })).toBeDisabled();
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Kitchen fire drill');
  await page.unroute(`**/api/staff/orders/${order.number}`);
  await expect(page.getByRole('button', { name: 'Mark Preparing' })).toBeEnabled({ timeout: 8000 });
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Kitchen fire drill');
}));

test('EXPERIENCE automatic updates neither erase typing nor move keyboard focus', withApp(tablet, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByLabel('Reason for cancelling').pressSequentially('Typing slowly');
  await page.waitForTimeout(2500);
  await expect(page.getByLabel('Reason for cancelling')).toBeFocused();
  await expect(page.getByLabel('Reason for cancelling')).toHaveValue('Typing slowly');
  await page.getByRole('link', { name: /Back to Active/ }).click();
  await page.locator(`#order-${order.number}`).focus();
  await page.waitForTimeout(2500);
  await expect(page.locator(`#order-${order.number}`)).toBeFocused();
}));

test('EXPERIENCE staff pages fit a phone without sideways scrolling', withApp({ viewport: PHONE }, async ({ app, page }) => {
  const order = await placeOrder(app);
  await signIn(page, app);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect(page.locator(`#order-${order.number}`)).toBeVisible();
  assert.equal(await overflow(), 0, 'queue');
  await openOrder(page, order.number);
  await page.getByRole('button', { name: 'Mark Preparing' }).waitFor();
  assert.equal(await overflow(), 0, 'detail');
}));
