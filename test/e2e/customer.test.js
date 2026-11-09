import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expect } from 'playwright/test';
import { costaRica } from '../harness.js';
import { addDishes, body, closeBrowser, launchBrowser, openCart, orderCount, withApp, WORKED } from './support.js';

before(launchBrowser);
after(closeBrowser);

const place = (page) => page.getByRole('button', { name: 'Place pickup order' });
const totalIs = (page, amount) => expect(page.locator('#cart-total')).toHaveText(amount);

test('A1 menu shows restaurant, hours, policy, prices and unavailable dishes', withApp({}, async ({ app, page }) => {
  await page.goto(app.base);
  await expect(page.getByRole('heading', { name: 'Chicken casado' })).toBeVisible();
  const text = await body(page).innerText();
  for (const expected of ['Mesa Tica', 'Pickup ordering', 'Open now', 'Monday through Sunday, 10:00 AM to 9:00 PM',
    'Pickup only. Pay at collection. Keep your tracking link private.', 'Rice, beans, chicken, salad and plantain.', '₡4,500', '₡1,000',
    'demo-contact@example.invalid', 'Demo contact — not monitored.']) {
    assert.ok(text.includes(expected), expected);
  }
  const fish = page.locator('.dish', { hasText: 'Fish casado' });
  await expect(fish.getByText('Unavailable')).toBeVisible();
  await expect(fish.getByRole('button')).toHaveCount(0);
  assert.deepEqual(await page.getByRole('heading', { level: 2 }).allInnerTexts(), ['Meals', 'Sides', 'Drinks']);
}));

test('A1 closed browsing works, submission is off and next opening is clear', withApp({ at: costaRica(9, 22) }, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await expect(page.locator('.closed-message')).toHaveText('Ordering is closed. Opens Tuesday, November 10, 10:00 AM.');
  await openCart(page);
  await expect(place(page)).toBeDisabled();
  await expect(page.locator('#place-why')).toHaveText('Ordering is closed. Opens Tuesday, November 10, 10:00 AM.');
}));

test('A1 no upcoming opening directs to contact without inventing a time', withApp({}, async ({ app, page }) => {
  const never = { ...app.db.prepare('SELECT data FROM restaurant').get() };
  app.db.prepare('UPDATE restaurant SET data = ?').run(JSON.stringify({ ...JSON.parse(never.data), openingHours: Array(7).fill(null) }));
  await page.goto(app.base);
  await expect(page.locator('.closed-message')).toContainText('The restaurant is currently closed. Contact demo-contact@example.invalid');
  assert.ok(!(await body(page).innerText()).includes('Opens '));
}));

test('A1 an empty menu says ordering is unavailable', withApp({}, async ({ app, page }) => {
  app.db.exec('DELETE FROM menu_items');
  await page.goto(app.base);
  await expect(page.getByText('Ordering is unavailable right now')).toBeVisible();
}));

test('A1 a failed menu load is not shown as an empty menu', withApp({}, async ({ app, page }) => {
  await page.route('**/api/menu', (route) => route.abort());
  await page.goto(app.base);
  await expect(page.getByText("We couldn't load the menu.")).toBeVisible();
  await page.unroute('**/api/menu');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Chicken casado' })).toBeVisible();
}));

test('A2 worked totals, one row per dish and explicit removal', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  await openCart(page);
  await expect(page.locator('.cart-row')).toHaveCount(3);
  await expect(page.locator('#qty-D2')).toHaveValue('2');
  await totalIs(page, '₡7,900');
  await expect(page.locator('#sub-D2')).toHaveText('Subtotal ₡2,000');
  await page.locator('#qty-D2').fill('3');
  await totalIs(page, '₡8,900');
  await page.locator('#qty-D2').fill('2');
  await page.getByRole('button', { name: 'Remove Cheese empanada' }).click();
  await totalIs(page, '₡6,500');
  await page.getByRole('button', { name: 'Remove Chicken casado' }).click();
  await page.getByRole('button', { name: 'Remove Iced tea' }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
  await expect(place(page)).toHaveCount(0);
}));

test('A2 invalid quantities get a correction, keep the row and block submission', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata', 2]]);
  await openCart(page);
  const qty = page.locator('#qty-D1');
  for (const bad of ['0', '-1', '1.5', 'abc', '']) {
    await qty.fill(bad);
    await expect(page.locator('#err-D1')).toHaveText('Enter a whole number greater than zero.');
    await expect(qty).toHaveValue(bad);
    await expect(qty).toHaveAttribute('aria-invalid', 'true');
    await totalIs(page, '₡2,600'); // the last valid quantity, never silently changed
    await expect(place(page)).toBeDisabled();
  }
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' })));
  await expect(qty).toHaveAttribute('aria-invalid', 'true'); // survives a full re-render too
  await qty.fill('4');
  await expect(page.locator('#err-D1')).toHaveText('');
  await totalIs(page, '₡5,200');
  await expect(place(page)).toBeEnabled();
}));

test('A2 typing keeps focus while totals update, and steppers work', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Iced tea']]);
  await openCart(page);
  await page.locator('#qty-D2').click();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('12');
  await expect(page.locator('#qty-D2')).toBeFocused();
  await totalIs(page, '₡12,000');
  await page.getByRole('button', { name: 'Decrease quantity of Iced tea' }).click();
  await totalIs(page, '₡11,000');
  await page.getByRole('button', { name: 'Increase quantity of Iced tea' }).click();
  await totalIs(page, '₡12,000');
}));

test('A2 corrupted browser data does not break the page', withApp({}, async ({ app, page }) => {
  await page.goto(app.base);
  await page.evaluate(() => {
    localStorage.setItem('mesa.pending.v1', '{"bad":1}');
    localStorage.setItem('mesa.cart.v1', '"oops"');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add Horchata' })).toBeEnabled();
  await expect(page.locator('#cart-link')).toContainText('0 items');
}));

test('A2 the cart survives a reload in the same browser', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  await page.reload();
  await expect(page.locator('#cart-link')).toContainText('₡7,900');
}));

test('A3/A5 a guest places an order without personal details and sees the confirmation', withApp({ permissions: ['clipboard-read', 'clipboard-write'] }, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  await openCart(page);
  assert.equal(await page.locator('input:not(.qty), textarea, select').count(), 0, 'no personal-information fields');
  await expect(page.getByText('Pay at collection.')).toBeVisible();
  await place(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  const text = await body(page).innerText();
  for (const expected of ['#1001', 'Received', 'Chicken casado', '₡7,900', 'Pay at collection.', 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.',
    'Save this link or bookmark the tracking page so you can check your order later. Anyone with this link can view this order.',
    "You can't change or cancel this order here."]) {
    assert.ok(text.includes(expected), expected);
  }
  await expect(page.locator('#cart-link')).toContainText('0 items');
  assert.equal(orderCount(app), 1);
  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  await expect(page.locator('#copy-status')).toHaveText('Link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /\/track\/[\w-]{43}$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new order' }).click();
  await expect(page.getByRole('heading', { name: 'Chicken casado' })).toBeVisible();
}));

test('A5 a failed copy offers a selectable link and manual guidance', withApp({}, async ({ app, page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await place(page).click();
  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  const manual = page.getByLabel('Select this link and copy it yourself');
  await expect(manual).toBeVisible();
  assert.match(await manual.inputValue(), /\/track\/[\w-]{43}$/);
  await expect(page.locator('#copy-status')).toHaveText('');
}));

test('A3 repeated taps produce one order', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await place(page).evaluate((button) => { button.click(); button.click(); button.click(); });
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  assert.equal(orderCount(app), 1);
}));

test('A3-REVIEW a price change while reviewing requires review and a fresh explicit submit', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  await openCart(page);
  await totalIs(page, '₡7,900');
  app.setPrice('M1', 4600);
  await place(page).click();
  await expect(page.getByText('Your order was not placed. Review the changes below, then place your order again.')).toBeVisible();
  await expect(page.getByText('Chicken casado is now ₡4,600. Review your updated total before placing the order.')).toBeVisible();
  await totalIs(page, '₡8,000');
  await expect(page.locator('.cart-row')).toHaveCount(3);
  assert.equal(orderCount(app), 0);
  await place(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expect(body(page)).toContainText('₡8,000');
  assert.equal(orderCount(app), 1);
}));

test('A3-REVIEW reopening the cart surfaces price changes before any submit', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  app.setPrice('M1', 4600);
  await page.reload();
  await page.locator('#cart-link').click();
  await expect(page.getByText('Chicken casado is now ₡4,600.')).toBeVisible();
  await totalIs(page, '₡8,000');
  await page.reload();
  await expect(page.getByText('Chicken casado is now ₡4,600.')).toBeVisible();
}));

test('A3-REVIEW the order cannot be placed until opening the cart has re-checked the menu', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  app.setPrice('M1', 4600);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/menu', async (route) => { await held; await route.continue(); });
  await page.getByRole('link', { name: /Review cart/ }).click();
  await expect(page.locator('#place-why')).toHaveText('Checking current prices and availability…');
  await expect(place(page)).toBeDisabled();
  release();
  await expect(page.getByText('Chicken casado is now ₡4,600.')).toBeVisible();
  await totalIs(page, '₡8,000');
  await expect(place(page)).toBeEnabled();
}));

test('A3 a closed rejection explains the next opening even if the menu never loaded', withApp({ at: costaRica(9, 22) }, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await page.evaluate(() => {
    const pending = { attempt: 'x'.repeat(32), selection: [{ itemId: 'D1', quantity: 1, reviewedPrice: 1300 }], lines: [{ name: 'Horchata', quantity: 1 }], total: 1300 };
    localStorage.setItem('mesa.pending.v1', JSON.stringify(pending));
  });
  await page.route('**/api/menu', (route) => route.abort());
  await page.goto(`${app.base}/#/cart`);
  await page.reload();
  await page.getByRole('button', { name: 'Check order' }).click();
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByText('Your order was not placed. Ordering is closed. Opens Tuesday, November 10, 10:00 AM.')).toBeVisible();
}));

test('A3-REVIEW an unavailable dish stays identified, blocks submit and keeps the rest of the cart', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  await openCart(page);
  app.setAvailable('S2', false);
  await place(page).click();
  await expect(page.getByText('Cheese empanada is no longer available. Remove it or choose another item.')).toBeVisible();
  await expect(page.locator('.cart-row')).toHaveCount(3);
  await expect(place(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Remove Cheese empanada' }).click();
  await totalIs(page, '₡6,500');
  await place(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  assert.equal(orderCount(app), 1);
}));

test('A3 closing while the page is open is decided by the server and keeps the cart', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  app.clock.t = costaRica(9, 21);
  await place(page).click();
  await expect(page.getByText('Your order was not placed. Ordering is closed. Opens Tuesday, November 10, 10:00 AM.')).toBeVisible();
  await expect(page.locator('.cart-row')).toHaveCount(1);
  assert.equal(orderCount(app), 0);
}));

/** Lets the request reach the server, then loses its response. */
const loseResponse = (page) => page.route('**/api/orders', async (route) => {
  await route.fetch();
  await route.abort();
}, { times: 1 });

test('A4 a lost confirmation is labeled honestly and recovered as the same order', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, WORKED);
  await openCart(page);
  await loseResponse(page);
  await place(page).click();
  await expect(page.getByText("We couldn't confirm the result. Check this order before placing another.")).toBeVisible();
  const text = await body(page).innerText();
  assert.ok(!/not placed|rejected|failed/i.test(text), 'never claims rejection');
  assert.ok(!text.includes('Order received'), 'never claims success');
  await expect(place(page)).toBeDisabled();
  await expect(page.locator('#qty-D2')).toBeDisabled();
  await page.reload();
  await page.locator('#cart-link').click();
  await expect(page.getByText("We couldn't confirm the result.")).toBeVisible();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expect(body(page)).toContainText('#1001');
  assert.equal(orderCount(app), 1);
  await expect(page.locator('#cart-link')).toContainText('0 items');
}));

test('A4 a request that never arrived offers a safe retry of the same attempt', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await page.route('**/api/orders', (route) => route.abort(), { times: 1 });
  await place(page).click();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('button', { name: 'Retry safely' })).toBeVisible();
  assert.equal(orderCount(app), 0);
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  assert.equal(orderCount(app), 1);
}));

test('A4 a failed check stays uncertain and can be tried again', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await loseResponse(page);
  await place(page).click();
  await page.route('**/api/orders/recover', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByText("We still couldn't reach the restaurant.")).toBeVisible();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  assert.equal(orderCount(app), 1);
}));

test('A4 accepted retry succeeds after closing', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await loseResponse(page);
  await place(page).click();
  await expect(page.getByRole('button', { name: 'Check order' })).toBeVisible();
  app.clock.t = costaRica(9, 22);
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  assert.equal(orderCount(app), 1);
}));

test('A4 retry that is definitively rejected explains it, keeps the cart and starts a new attempt', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await page.route('**/api/orders', (route) => route.abort(), { times: 1 });
  await place(page).click();
  await page.getByRole('button', { name: 'Check order' }).click();
  await page.getByRole('button', { name: 'Retry safely' }).waitFor();
  app.setPrice('D1', 1500);
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByText('Horchata is now ₡1,500.')).toBeVisible();
  await expect(page.getByText("We couldn't confirm the result.")).toHaveCount(0);
  assert.equal(orderCount(app), 0);
  await totalIs(page, '₡1,500');
  await place(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  assert.equal(orderCount(app), 1);
}));

test('A4 while an attempt is unresolved the menu cannot start a new order', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await loseResponse(page);
  await place(page).click();
  await page.getByRole('button', { name: 'Check order' }).waitFor();
  await page.goto(`${app.base}/#/`);
  await expect(page.getByText("We couldn't confirm the result.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Iced tea' })).toBeDisabled();
}));

test('A5 recovering a cancelled order omits payment and does not reset its status', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await loseResponse(page);
  await place(page).click();
  await page.getByRole('button', { name: 'Check order' }).waitFor();
  app.db.prepare("UPDATE orders SET status = 'Cancelled', revision = 2, cancellation_reason = 'Out of rice'").run();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('heading', { name: 'We found your order' })).toBeVisible();
  const text = await body(page).innerText();
  assert.ok(text.includes('This order was cancelled.'));
  assert.ok(!text.includes('Pay at collection.'));
  assert.ok(!text.includes('Order received'));
}));

test('A4 a deliberate second order is separate', withApp({}, async ({ app, page }) => {
  await addDishes(page, app, [['Horchata']]);
  await openCart(page);
  await place(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new order' }).click();
  await page.getByRole('button', { name: 'Add Horchata' }).click();
  await openCart(page);
  await place(page).click();
  await expect(body(page)).toContainText('#1002');
  assert.equal(orderCount(app), 2);
}));

test('EXPERIENCE ordering works by keyboard and fits a phone without sideways scrolling', withApp({}, async ({ app, page }) => {
  await page.goto(app.base);
  await page.getByRole('button', { name: 'Add Horchata' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cart-link')).toContainText('1 item');
  await expect(page.getByRole('button', { name: 'Add Horchata' })).toBeFocused();
  for (const path of ['#/', '#/cart']) {
    await page.goto(`${app.base}/${path}`);
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, path);
  }
}));
