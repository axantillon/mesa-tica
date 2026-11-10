import { TIMES, addWorkedCart, cartTotal, expect, test } from './fixtures.js';

const UNCERTAIN = "We couldn't confirm the result. Check this order before placing another.";
const placeButton = (page) => page.getByRole('button', { name: 'Place pickup order' });

/** The request reaches the server (and commits) but the browser never receives the response. */
async function loseNextSubmissionResponse(page) {
  await page.route('**/api/orders', async (route) => {
    await route.fetch();
    await route.abort('failed');
  }, { times: 1 });
}

test('A4: a lost confirmation is labelled uncertain, survives reload and Check order recovers the same order', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  await loseNextSubmissionResponse(page);
  await placeButton(page).click();

  await expect(page.getByText(UNCERTAIN)).toBeVisible();
  await expect(page.getByText('Order received')).toHaveCount(0);
  await expect(placeButton(page)).toBeDisabled();
  await expect(page.locator('#submit-help')).toHaveText('Check your previous order attempt before placing another order.');
  expect(app.counts().orders).toBe(1);

  await page.reload();
  await expect(page.getByText(UNCERTAIN)).toBeVisible();
  await expect(page.locator('#customer-notices')).toContainText('Total ₡7,900');
  await page.getByRole('button', { name: 'Check order' }).click();

  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  const { number } = app.db.prepare('SELECT number FROM orders').get();
  await expect(page.locator('.order-number')).toHaveText(`Order number ${number}`);
  expect(app.counts().orders).toBe(1);
  await page.getByRole('button', { name: 'Start a new order' }).click();
  await expect(page.getByText('Your cart is empty.', { exact: true })).toBeVisible();
});

test('A4: when the request never arrived, Check order stays uncertain and Retry safely creates exactly one order', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  await page.route('**/api/orders', (route) => route.abort('failed'), { times: 1 });
  await placeButton(page).click();
  await expect(page.getByText(UNCERTAIN)).toBeVisible();
  expect(app.counts()).toMatchObject({ orders: 0, attempts: 0 });

  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByText("We couldn't find a confirmed result for this attempt yet.", { exact: false })).toBeVisible();
  await expect(page.getByText(UNCERTAIN)).toBeVisible();

  // The cart can change, but Retry safely still sends the original reviewed selection.
  await page.getByRole('button', { name: 'Add Horchata to cart' }).click();
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expect(page.locator('#confirmation-view .total')).toHaveText('Total ₡7,900');
  expect(app.counts().orders).toBe(1);
  expect(app.db.prepare("SELECT COUNT(*) AS n FROM order_items WHERE item_code = 'D1'").get().n).toBe(0);
  await page.getByRole('button', { name: 'Start a new order' }).click();
  await expect(page.locator('.cart-row')).toHaveCount(1);
  await expect(page.locator('.cart-row')).toContainText('Horchata');
});

test('A4: repeated taps while placing an order send one submission', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  let posts = 0;
  await page.route('**/api/orders', async (route) => {
    posts += 1;
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await placeButton(page).click();
  await expect(page.getByRole('heading', { name: 'Placing your order…' })).toBeVisible();
  await expect(placeButton(page)).toBeDisabled();
  await placeButton(page).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  expect(posts).toBe(1);
  expect(app.counts().orders).toBe(1);
});

test('A4: an accepted attempt retried after closing returns the original order', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  await loseNextSubmissionResponse(page);
  await placeButton(page).click();
  await expect(page.getByText(UNCERTAIN)).toBeVisible();

  app.clock.set(TIMES.closingInstant);
  await page.reload();
  await page.getByRole('button', { name: 'Retry safely' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  const { number } = app.db.prepare('SELECT number FROM orders').get();
  await expect(page.locator('.order-number')).toHaveText(`Order number ${number}`);
  expect(app.counts().orders).toBe(1);
});

test('A4: a recorded rejection is returned by Check order after reload and stays closed', async ({ page, app }) => {
  app.clock.set(TIMES.closingInstant);
  await page.goto('/');
  await addWorkedCart(page);
  // The page still believes it is open (loaded just before closing).
  app.clock.set('2026-11-10T20:59:50-06:00');
  await page.reload();
  app.clock.set(TIMES.closingInstant);
  await loseNextSubmissionResponse(page);
  await placeButton(page).click();
  await expect(page.getByText(UNCERTAIN)).toBeVisible();
  expect(app.counts()).toMatchObject({ orders: 0, attempts: 1 });

  app.clock.set(TIMES.open);
  await page.reload();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.locator('#outcome-message')).toContainText('Ordering is closed. Opens Wednesday, November 11 at 10:00 AM (Costa Rica time).');
  await expect(page.getByText(UNCERTAIN)).toHaveCount(0);
  await expect(cartTotal(page)).toHaveText('Total ₡7,900');
  expect(app.counts()).toMatchObject({ orders: 0, attempts: 1 });
  const attempt = app.db.prepare('SELECT outcome FROM submission_attempts').get();
  expect(attempt.outcome).toBe('closed');

  // A deliberate corrected submission starts a new attempt and is accepted now that ordering is open.
  await expect(placeButton(page)).toBeEnabled();
  await placeButton(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  expect(app.counts()).toMatchObject({ orders: 1, attempts: 2 });
});

test('A4: an unavailable check keeps the attempt uncertain and offers recovery again', async ({ page, app }) => {
  await page.goto('/');
  await addWorkedCart(page);
  await loseNextSubmissionResponse(page);
  await placeButton(page).click();
  await expect(page.getByText(UNCERTAIN)).toBeVisible();
  await page.route('**/api/orders/recover', (route) => route.abort('timedout'), { times: 1 });
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByText("We couldn't reach Mesa Tica to check this order. Your attempt is saved. Try Check order again.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Check order' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  expect(app.counts().orders).toBe(1);
});
