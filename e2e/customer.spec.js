import { TIMES, addWorkedCart, cartTotal, expect, test } from './fixtures.js';

const quantity = (page, name) => page.getByRole('textbox', { name: `Quantity for ${name}` });
const placeButton = (page) => page.getByRole('button', { name: 'Place pickup order' });

test('A1/A2/A3: browse, edit the cart with corrections and place one Received order', async ({ page, app }) => {
  await page.goto('/');
  await expect(page.locator('.opening')).toHaveText('● Open now');
  await expect(page.getByText('Hours (Costa Rica time): Every day: 10:00 AM – 9:00 PM')).toBeVisible();
  await expect(page.getByText('Pickup only. Pay at collection. Keep your tracking link private.')).toBeVisible();

  // Every dish shows name, description and price; Fish casado is visible but has no Add action.
  const fish = page.locator('.dish', { hasText: 'Fish casado' });
  await expect(fish).toContainText('Rice, beans, fish and salad.');
  await expect(fish).toContainText('₡5,000');
  await expect(fish).toContainText('Unavailable');
  await expect(fish.getByRole('button')).toHaveCount(0);
  await expect(page.locator('.dish', { hasText: 'Chicken casado' })).toContainText('₡4,500');
  await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /^(Meals|Sides|Drinks)$/ })).toHaveText(['Meals', 'Sides', 'Drinks']);

  await expect(page.getByText('Your cart is empty.', { exact: true })).toBeVisible();
  await expect(placeButton(page)).toBeDisabled();

  await addWorkedCart(page);
  await expect(page.locator('.cart-row')).toHaveCount(3);
  await expect(quantity(page, 'Iced tea')).toHaveValue('2');

  await quantity(page, 'Iced tea').fill('3');
  await quantity(page, 'Iced tea').press('Enter');
  await expect(cartTotal(page)).toHaveText('Total ₡8,900');

  for (const invalid of ['0', '-1', '1.5', 'abc']) {
    await quantity(page, 'Iced tea').fill(invalid);
    await quantity(page, 'Iced tea').press('Enter');
    await expect(page.locator('.cart-row', { hasText: 'Iced tea' }).getByRole('alert')).toHaveText('Enter a whole number greater than zero.');
    await expect(quantity(page, 'Iced tea')).toHaveValue(invalid);
    await expect(cartTotal(page)).toHaveText('Total ₡8,900');
    await expect(placeButton(page)).toBeDisabled();
  }
  await quantity(page, 'Iced tea').fill('2');
  await quantity(page, 'Iced tea').press('Enter');
  await expect(page.getByText('Enter a whole number greater than zero.')).toHaveCount(0);
  await expect(cartTotal(page)).toHaveText('Total ₡7,900');

  await page.getByRole('button', { name: 'Remove Cheese empanada' }).click();
  await expect(cartTotal(page)).toHaveText('Total ₡6,500');
  await page.getByRole('button', { name: 'Add Cheese empanada to cart' }).click();
  await expect(cartTotal(page)).toHaveText('Total ₡7,900');

  // The cart survives a reload in the same browser.
  await page.reload();
  await expect(cartTotal(page)).toHaveText('Total ₡7,900');
  expect(app.counts().orders).toBe(0);

  await placeButton(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  const row = app.db.prepare('SELECT number, status, total FROM orders').get();
  expect({ ...row, count: app.counts().orders }).toEqual({ number: row.number, status: 'Received', total: 7900, count: 1 });
  await expect(page.locator('.order-number')).toHaveText(`Order number ${row.number}`);
  await expect(page.locator('#confirmation-view')).toContainText('1 × Chicken casado (₡4,500 each) — ₡4,500');
  await expect(page.locator('#confirmation-view')).toContainText('2 × Iced tea (₡1,000 each) — ₡2,000');
  await expect(page.locator('#confirmation-view .total')).toHaveText('Total ₡7,900');
  await expect(page.locator('#confirmation-view')).toContainText('Pay at collection.');
  await expect(page.locator('#confirmation-view .status')).toHaveText('● Received');

  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const token = app.db.prepare('SELECT private_token FROM orders').get().private_token;
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${app.url}/track/${token}`);

  // Known acceptance empties the purchased cart; a new order would be separate.
  await page.getByRole('button', { name: 'Start a new order' }).click();
  await expect(page.getByText('Your cart is empty.', { exact: true })).toBeVisible();
  await expect(page.getByText(`Your order ${row.number} is saved in this tab.`)).toBeVisible();
  expect(app.counts().orders).toBe(1);
});

test('A2: removing the final item returns the empty cart and disables submission', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Horchata to cart' }).click();
  await expect(placeButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Remove Horchata' }).click();
  await expect(page.getByText('Your cart is empty.', { exact: true })).toBeVisible();
  await expect(placeButton(page)).toBeDisabled();
  await expect(page.locator('#submit-help')).toHaveText('Your cart is empty. Add a dish to place an order.');
});

test('A1: closed browsing explains the next opening; a page left open across closing is rejected by the server', async ({ page, app }) => {
  app.clock.set(TIMES.closingInstant);
  await page.goto('/');
  await expect(page.locator('.opening')).toHaveText('○ Closed');
  const closedMessage = 'Ordering is closed. Opens Wednesday, November 11 at 10:00 AM (Costa Rica time).';
  await expect(page.locator('.opening-message')).toHaveText(closedMessage);
  await addWorkedCart(page);
  await expect(placeButton(page)).toBeDisabled();
  await expect(page.locator('#submit-help')).toHaveText(closedMessage);

  app.clock.set('2026-11-10T20:59:50-06:00');
  await page.reload();
  await expect(placeButton(page)).toBeEnabled();
  app.clock.set(TIMES.closingInstant);
  await placeButton(page).click();
  await expect(page.locator('#outcome-message')).toContainText(closedMessage);
  await expect(page.locator('#outcome-message')).toContainText('Your cart was kept.');
  await expect(cartTotal(page)).toHaveText('Total ₡7,900');
  await expect(placeButton(page)).toBeDisabled();
  expect(app.counts().orders).toBe(0);
});

test('A1: an empty weekly schedule says closed and shows contact instead of a reopening time', async ({ page, app }) => {
  app.setWeeklyHours({});
  await page.goto('/');
  await expect(page.locator('.opening-message')).toHaveText(
    'Ordering is closed. The restaurant is currently closed and has no upcoming opening hours. Contact demo-contact@example.invalid (Demo contact — not monitored).',
  );
  await expect(page.locator('.contact')).toHaveText('Contact: demo-contact@example.invalid (Demo contact — not monitored)');
  await expect(page.getByText(/Opens /)).toHaveCount(0);
});

test('A1: an empty menu says ordering is unavailable', async ({ page, app }) => {
  app.db.prepare('DELETE FROM menu_items').run();
  await page.goto('/');
  await expect(page.locator('#menu-content')).toHaveText('Ordering is unavailable right now because the menu has no dishes.');
  await expect(placeButton(page)).toBeDisabled();
});

test('A3-REVIEW: a repriced dish needs review and a fresh explicit submission', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  app.setMenuItem('M1', { price: 4600 });
  await placeButton(page).click();
  const notice = 'Chicken casado is now ₡4,600. Review your updated total before placing the order.';
  await expect(page.locator('#outcome-message')).toContainText(notice);
  await expect(page.locator('.cart-row', { hasText: 'Chicken casado' })).toContainText(notice);
  await expect(cartTotal(page)).toHaveText('Total ₡8,000');
  expect(app.counts().orders).toBe(0);
  expect(app.counts().attempts).toBe(1);

  await placeButton(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expect(page.locator('#confirmation-view .total')).toHaveText('Total ₡8,000');
  expect(app.counts()).toMatchObject({ orders: 1, attempts: 2 });
  expect(app.db.prepare("SELECT unit_price FROM order_items WHERE item_code = 'M1'").get().unit_price).toBe(4600);
});

test('A3-REVIEW: an unavailable dish stays identified and must be removed; nothing is substituted', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  app.setMenuItem('S2', { available: false });
  await placeButton(page).click();
  const message = 'Cheese empanada is no longer available. Remove it or choose another item.';
  await expect(page.locator('#outcome-message')).toContainText(message);
  await expect(page.locator('.cart-row', { hasText: 'Cheese empanada' })).toContainText(message);
  await expect(quantity(page, 'Cheese empanada')).toHaveValue('1');
  await expect(placeButton(page)).toBeDisabled();
  await expect(page.locator('#submit-help')).toHaveText('Remove unavailable items before placing your order.');
  expect(app.counts().orders).toBe(0);

  await page.getByRole('button', { name: 'Remove Cheese empanada' }).click();
  await placeButton(page).click();
  await expect(page.locator('#confirmation-view .total')).toHaveText('Total ₡6,500');
  expect(app.counts().orders).toBe(1);
  expect(app.db.prepare("SELECT COUNT(*) AS n FROM order_items WHERE item_code = 'S2'").get().n).toBe(0);
});

test('A3-REVIEW: reopening the page with a stored cart checks current prices before ordering', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  app.setMenuItem('M1', { price: 4600 });
  await page.reload();
  await expect(page.locator('.cart-row', { hasText: 'Chicken casado' })).toContainText('Chicken casado is now ₡4,600.');
  await expect(cartTotal(page)).toHaveText('Total ₡8,000');
  expect(app.counts().orders).toBe(0);
});
