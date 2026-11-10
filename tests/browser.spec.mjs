import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fixture, selection, closedTime, openTime } from './fixture.mjs';
import { restaurant } from '../src/sample.mjs';

let f;
test.beforeEach(async () => { f = await fixture(); });
test.afterEach(async () => { await f.close(); });
const main = page => page.locator('main');
async function menu(page) { await page.goto(`${f.base}/`); await expect(page.getByRole('heading', { name: 'Your pickup order' })).toBeVisible(); }
async function addWorkedCart(page) {
  for (const name of ['Chicken casado', 'Cheese empanada', 'Iced tea', 'Iced tea']) await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
}
async function staff(page, number = null, username = 'luis') {
  await page.goto(`${f.base}/staff${number ? `#order-${number}` : ''}`);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: number ? 'Order detail' : 'Order queue', exact: true })).toBeVisible();
  if (number) await expect(page.getByRole('heading', { name: `Order #${number}`, exact: true })).toBeVisible();
}
async function noAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, count: nodes.length, targets: nodes.map(node => node.target) }))).toEqual([]);
}

test('A1/A2/A3/A5: real ordering, quantities, worked totals, copy and confirmation restoration', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await menu(page);
  await expect(page).toHaveTitle('Mesa Tica · Pickup ordering');
  expect(page.url()).toBe(`${f.base}/`);
  await expect(page.getByRole('button', { name: 'Fish casado unavailable' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Place pickup order' })).toBeDisabled();
  await addWorkedCart(page);
  await expect(page.locator('#cart-total')).toHaveText('₡7,900');
  const quantity = page.getByLabel('Quantity for Iced tea');
  await quantity.fill('3');
  await expect(page.locator('#cart-total')).toHaveText('₡8,900');
  for (const value of ['0', '-1', '1.5', 'one']) {
    await quantity.fill(value);
    await expect(page.locator('#err-D2')).toContainText('whole number greater than zero');
    await expect(page.getByRole('button', { name: 'Place pickup order' })).toBeDisabled();
    await expect(quantity).toHaveValue(value);
  }
  await quantity.fill('2');
  await page.getByRole('button', { name: 'Remove Cheese empanada' }).click();
  await expect(page.locator('#cart-total')).toHaveText('₡6,500');
  await page.getByRole('button', { name: 'Add Cheese empanada', exact: true }).click();
  await page.reload();
  await expect(page.locator('#cart-total')).toHaveText('₡7,900');
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  await expect(main(page)).toContainText('₡7,900');
  await expect(main(page)).toContainText('not ready for pickup yet');
  expect(f.count()).toBe(1);
  await expect(page.locator('#cart-count')).toHaveText('0');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  await expect(page.locator('#copy-feedback')).toHaveText('Link copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/track#');
  const link = await page.getByLabel('Private tracking link').inputValue();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  await expect(page.getByLabel('Private tracking link')).toHaveValue(link);
  await page.getByRole('link', { name: 'Back to menu / start a new order' }).click();
  await expect(page.getByText('Your cart is empty.', { exact: false })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  expect(f.count()).toBe(1);
  expect(errors).toEqual([]);
});

test('A4: lost acceptance, reload, safe retry after closing creates exactly one order', async ({ page }) => {
  await menu(page); await addWorkedCart(page);
  await page.route('**/api/checkout', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('button', { name: 'Retry safely' })).toBeEnabled();
  expect(f.count()).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check order' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Chicken casado', exact: true })).toBeDisabled();
  f.setTime(closedTime);
  await page.unroute('**/api/checkout');
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  expect(f.count()).toBe(1);
  await expect(page.locator('#cart-count')).toHaveText('0');
});

test('A4: recorded rejection survives lost response and reload; Check order returns correction', async ({ page }) => {
  await menu(page); await addWorkedCart(page);
  const changed = f.store.readSetting('menu'); changed[0].price = 4600; f.setting('menu', changed);
  await page.route('**/api/checkout', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('button', { name: 'Check order' })).toBeEnabled();
  expect(f.count()).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.locator('#cart')).toContainText('Chicken casado is now ₡4,600');
  await expect(page.locator('#cart-total')).toHaveText('₡8,000');
  await expect(page.getByRole('button', { name: 'Retry safely' })).toHaveCount(0);
  expect(f.count()).toBe(0);
  await page.unroute('**/api/checkout');
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  expect(f.count()).toBe(1);
});

test('A4: absent attempt remains uncertain until an explicit safe retry', async ({ page }) => {
  await menu(page); await addWorkedCart(page);
  await page.route('**/api/checkout', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('button', { name: 'Check order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.locator('#cart')).toContainText('outcome remains uncertain');
  expect(f.count()).toBe(0);
  await page.unroute('**/api/checkout');
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  expect(f.count()).toBe(1);
});

test('A5: restored confirmation marks cached status stale and retains link offline', async ({ page }) => {
  await menu(page); await addWorkedCart(page);
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.locator('#freshness')).toContainText('Last checked');
  const link = await page.getByLabel('Private tracking link').inputValue();
  await page.route('**/api/tracking/**', route => route.abort('failed'));
  await page.reload();
  await expect(page.locator('#freshness')).toContainText('This status may be out of date');
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  await expect(page.getByLabel('Private tracking link')).toHaveValue(link);
  await page.unroute('**/api/tracking/**');
  await expect(page.locator('#freshness')).toContainText('Last checked');
  expect(f.count()).toBe(1);
});

test('A5: unavailable storage and clipboard retain manual save route', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('copy denied'); } } });
  });
  await menu(page); await addWorkedCart(page);
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  await expect(page.locator('#storage-warning')).toContainText('Save this tracking link before leaving');
  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  await expect(page.locator('#copy-feedback')).toContainText('copy the link above manually');
  await expect(page.getByLabel('Private tracking link')).toBeFocused();
  expect(await page.getByLabel('Private tracking link').inputValue()).toContain('/track#');
  expect(f.count()).toBe(1);
});

test('A5/C3: recovered cancelled acceptance and restored confirmation omit payment invitation', async ({ page }) => {
  await menu(page); await addWorkedCart(page);
  await page.route('**/api/checkout', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('button', { name: 'Check order' })).toBeEnabled();
  const cookie = (await f.login()).cookie;
  await f.request('/api/staff/orders/1', { method: 'POST', cookie, body: { revision: 1, target: 'Cancelled', reason: 'Kitchen equipment unavailable' } });
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('heading', { name: 'Order cancelled', exact: true })).toBeVisible();
  await expect(main(page)).toContainText('Kitchen equipment unavailable');
  await expect(main(page)).toContainText('Demo contact — not monitored');
  await expect(main(page)).not.toContainText('Pay at collection');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Order cancelled', exact: true })).toBeVisible();
  expect(f.count()).toBe(1);
});

test('B1/B1-STALE: queue live arrival, filter retention, stale/recovery, sign out', async ({ page }) => {
  await staff(page);
  await expect(page.getByText('No active orders.')).toBeVisible();
  await f.place();
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByLabel('Show orders').selectOption('All');
  await page.getByRole('link', { name: /Order #1/ }).click();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to queue' }).click();
  await expect(page.getByLabel('Show orders')).toHaveValue('All');
  await expect(page.locator('#freshness')).toContainText('Last checked');
  const last = await page.locator('#freshness').textContent();
  await page.route('**/api/staff/orders?*', route => route.abort('failed'));
  await expect(page.locator('#freshness')).toContainText('may be out of date');
  await expect(page.locator('.queue-item')).toHaveCount(1);
  expect(await page.locator('#freshness').textContent()).toContain(last.match(/Last checked (.*?) ·/)[1]);
  await page.unroute('**/api/staff/orders?*');
  await expect(page.locator('#freshness')).not.toContainText('may be out of date');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();
  await expect(page.locator('.queue-item')).toHaveCount(0);
});

test('B3/B3-CONFLICT: cancellation dismissal, focus, frozen revision conflict and deliberate recovery', async ({ page, browser }) => {
  await f.place();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await staff(page, 1); await staff(other, 1, 'elena');
    await page.getByLabel('Customer-visible cancellation reason').fill('Kitchen unavailable');
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep order' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Cancel order', exact: true })).toBeFocused();
    expect(f.store.readOrder(1).history).toHaveLength(0);
    await expect(page.getByLabel('Customer-visible cancellation reason')).toHaveValue('Kitchen unavailable');
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await other.getByRole('button', { name: 'Mark Preparing' }).click();
    await expect(other.locator('#action-message')).toContainText('Saved: Preparing');
    await expect(page.locator('#detail-summary')).toContainText('Preparing');
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.locator('#action-message')).toContainText('This order changed');
    expect(f.store.readOrder(1).status).toBe('Preparing');
    expect(f.store.readOrder(1).history).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Mark Ready' })).toBeEnabled();
    await expect(page.getByLabel('Customer-visible cancellation reason')).toHaveValue('Kitchen unavailable');
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.locator('#action-message')).toContainText('Saved: Cancelled');
    expect(f.store.readOrder(1).history).toHaveLength(2);
    const history = f.store.readOrder(1).history;
    expect(history.map(change => change.username)).toEqual(['elena', 'luis']);
    await expect(page.getByRole('button', { name: 'Mark Ready' })).toHaveCount(0);
  } finally { await otherContext.close(); }
});

test('B3-CONFLICT: refresh failure and access expiry retain only same-order draft; no automatic write', async ({ page }) => {
  await f.place(); await f.place();
  await staff(page, 1);
  const reason = page.getByLabel('Customer-visible cancellation reason');
  await reason.fill('Equipment needs attention');
  await page.route('**/api/staff/orders/1', route => route.abort('failed'));
  await expect(page.locator('#freshness')).toContainText('may be out of date');
  await expect(reason).toHaveValue('Equipment needs attention');
  await expect(page.getByRole('button', { name: 'Cancel order', exact: true })).toBeDisabled();
  await page.unroute('**/api/staff/orders/1');
  f.store.db.exec('DELETE FROM sessions');
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();
  await expect(main(page)).not.toContainText('Chicken casado');
  await expect(main(page)).not.toContainText('Equipment needs attention');
  await page.getByLabel('Username', { exact: true }).fill('luis');
  await page.getByLabel('Password', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Order #1' })).toBeVisible();
  await expect(page.getByLabel('Customer-visible cancellation reason')).toHaveValue('Equipment needs attention');
  expect(f.store.readOrder(1).history).toHaveLength(0);
  await page.goto(`${f.base}/staff#order-2`);
  await expect(page.getByLabel('Customer-visible cancellation reason')).toHaveValue('');
  expect(f.store.readOrder(2).history).toHaveLength(0);
});

test('B3: lost staff-write response refreshes actual history without automatically repeating action', async ({ page }) => {
  await f.place(); await staff(page, 1);
  await page.route('**/api/staff/orders/1', async route => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(page.locator('#action-message')).toContainText('could not be confirmed');
  await expect(page.locator('#detail-summary')).toContainText('Preparing');
  await expect(page.getByRole('button', { name: 'Mark Ready' })).toBeEnabled();
  expect(f.store.readOrder(1).history).toHaveLength(1);
  expect(f.store.readOrder(1).revision).toBe(2);
});

test('C1/C2/C3: tracking progress, stale Ready, recovery, Collected and invalid/initial failure meanings', async ({ page }) => {
  const placed = await f.place();
  const cookie = (await f.login()).cookie;
  const update = (revision, target) => f.request('/api/staff/orders/1', { method: 'POST', cookie, body: { revision, target } });
  await page.goto(`${f.base}/track#${placed.data.privateKey}`);
  await expect(main(page)).toContainText('not ready for pickup yet');
  await update(1, 'Preparing'); await expect(page.locator('#order-summary')).toContainText('Preparing');
  await expect(page.locator('#announce')).toContainText('Preparing');
  await update(2, 'Ready'); await expect(main(page)).toContainText('Show your order number and pay at collection');
  await page.route('**/api/tracking/**', route => route.abort('failed'));
  await expect(page.locator('#freshness')).toContainText('This status may be out of date');
  await expect(page.locator('#order-summary')).toContainText('Ready');
  await update(3, 'Collected');
  await page.unroute('**/api/tracking/**');
  await expect(page.locator('#order-summary')).toContainText('This order has been collected');
  await expect(page.locator('#freshness')).not.toContainText('out of date');
  await expect(page.locator('#order-summary')).not.toContainText('pay at collection');
  await expect(main(page)).not.toContainText('Luis');
  await page.route('**/api/tracking/**', route => route.abort('failed'));
  await page.reload();
  await expect(page.locator('#freshness')).toContainText('No current order information has loaded');
  await expect(page.locator('#order-summary')).toBeEmpty();
  await expect(page.locator('#freshness')).not.toContainText('Last checked');
  await expect(page.locator('#freshness')).not.toContainText("couldn't open this tracking link");
  await page.unroute('**/api/tracking/**');
  await page.goto(`${f.base}/track#1`);
  await expect(page.locator('#freshness')).toContainText("We couldn't open this tracking link");
  await expect(page.locator('#order-summary')).toBeEmpty();
});

test('A1/A3-REVIEW: closed browsing, unavailable correction and no upcoming opening', async ({ page }) => {
  f.setTime(closedTime);
  await menu(page);
  await page.getByRole('button', { name: 'Add Chicken casado', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place pickup order' })).toBeDisabled();
  await expect(main(page)).toContainText('Tuesday, Nov 10, 10:00 AM');
  f.setTime(openTime); await page.reload();
  const changed = f.store.readSetting('menu'); changed[0].available = false; f.setting('menu', changed);
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.locator('#cart')).toContainText('Chicken casado is no longer available');
  await expect(page.getByLabel('Quantity for Chicken casado')).toHaveValue('1');
  expect(f.count()).toBe(0);
  f.setting('restaurant', { ...restaurant, hours: [] });
  await page.reload();
  await expect(main(page)).toContainText('no upcoming opening');
  await expect(page.getByRole('button', { name: 'Place pickup order' })).toBeDisabled();
});

test('A1/EXPERIENCE: crossing closing time updates guidance without moving cart input focus', async ({ page }) => {
  await menu(page);
  await page.getByRole('button', { name: 'Add Chicken casado', exact: true }).click();
  const quantity = page.getByLabel('Quantity for Chicken casado');
  await quantity.fill('3'); await quantity.focus();
  f.setTime(closedTime);
  await expect(page.locator('#opening-state')).toHaveText('Ordering closed', { timeout: 15000 });
  await expect(quantity).toBeFocused();
  await expect(quantity).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Place pickup order' })).toBeDisabled();
  await expect(page.locator('#cart-opening')).toContainText('Tuesday, Nov 10');
  expect(f.count()).toBe(0);
});

test('EXPERIENCE: keyboard, mobile/desktop reflow, 200% text, reduced motion and accessible surfaces', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await menu(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(main(page)).toBeFocused();
  await page.getByRole('heading', { name: /A good meal/ }).click();
  await noAxeViolations(page);
  const evidence = process.env.MESA_SCREENSHOT_DIR || '/tmp/mesa-evidence';
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/desktop-menu.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await noAxeViolations(page);
  const undersized = await page.locator('button, nav a').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.height < 44 || rect.width < 44);
  }).map(element => element.textContent));
  expect(undersized).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/mobile-menu.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = '34px'; });
  await page.screenshot({ path: `${evidence}/mobile-text-200.png`, fullPage: true });
  const dishOverlap = await page.locator('.dish').evaluateAll(rows => rows.some(row => {
    const [copy, button] = row.children;
    const b = button.getBoundingClientRect();
    return Array.from(copy.querySelectorAll('h3,p,span')).some(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return Array.from(range.getClientRects()).some(a => a.right > b.left && a.left < b.right && a.top < b.bottom && b.top < a.bottom);
    });
  }));
  expect(dishOverlap).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await addWorkedCart(page);
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.locator('#freshness')).toContainText('Last checked');
  await noAxeViolations(page);
  await page.screenshot({ path: `${evidence}/mobile-confirmation.png`, fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await staff(page, 1);
  await noAxeViolations(page);
  const reason = page.getByLabel('Customer-visible cancellation reason');
  await reason.fill('Kitchen unavailable'); await reason.focus();
  const checked = await page.locator('#freshness').textContent();
  // A clock change lets us observe the next automatic successful read explicitly.
  f.setTime('2026-11-09T16:00:05Z');
  await expect(page.locator('#freshness')).not.toHaveText(checked);
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue('Kitchen unavailable');
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await noAxeViolations(page);
  await page.screenshot({ path: `${evidence}/staff-cancellation.png`, fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Confirm cancellation' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Keep order' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Confirm cancellation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Cancel order', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
