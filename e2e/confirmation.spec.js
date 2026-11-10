import { addWorkedCart, expect, staffChange, test } from './fixtures.js';

const placeButton = (page) => page.getByRole('button', { name: 'Place pickup order' });

async function placeWorkedOrder(page, app) {
  await page.goto('/');
  await addWorkedCart(page);
  await placeButton(page).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  return app.db.prepare('SELECT number, private_token FROM orders ORDER BY number DESC').get();
}

test('A5: reload right after acceptance and navigating away/back keep the confirmation without a new order', async ({ page, app }) => {
  const order = await placeWorkedOrder(page, app);
  await page.reload();
  await expect(page.locator('.order-number')).toHaveText(`Order number ${order.number}`);
  await expect(page.getByText(/^Current status checked at /)).toBeVisible();
  await expect(page.locator('#tracking-link')).toHaveValue(`${app.url}/track/${order.private_token}`);
  expect(app.counts().orders).toBe(1);

  // Progress made by staff is fetched through the private-link read path, never reset to Received.
  await staffChange(app, order.number, 'Preparing');
  await page.getByRole('link', { name: 'View order progress' }).click();
  await expect(page).toHaveURL(`${app.url}/track/${order.private_token}`);
  await expect(page.getByText('Your meal is being prepared. It is not ready for pickup yet.')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#confirmation-view .status')).toHaveText('◐ Preparing');
  await expect(page.getByRole('heading', { name: 'Your order' })).toBeVisible();
  await expect(page.locator('#confirmation-view')).toContainText('Pay at collection.');
  expect(app.counts().orders).toBe(1);

  // The purchased cart is not restored.
  await page.getByRole('button', { name: 'Start a new order' }).click();
  await expect(page.getByText('Your cart is empty.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View confirmation and tracking link' }).click();
  await expect(page.locator('.order-number')).toHaveText(`Order number ${order.number}`);
});

test('A5: a recovered cancelled order shows its status without payment instructions', async ({ page, app }) => {
  const order = await placeWorkedOrder(page, app);
  await staffChange(app, order.number, 'Cancelled', { reason: 'Kitchen closed early' });
  await page.reload();
  await expect(page.locator('#confirmation-view .status')).toHaveText('✕ Cancelled');
  await expect(page.getByText('This order was cancelled. It will not be prepared or collected.')).toBeVisible();
  await expect(page.getByText('View order progress for the reason and the restaurant contact.')).toBeVisible();
  await expect(page.locator('#confirmation-view')).not.toContainText('Pay at collection');
  await expect(page.locator('#confirmation-view')).not.toContainText('Collect at the Mesa Tica pickup counter');
});

test('A5: an offline return keeps the link and marks cached status as possibly out of date', async ({ page, app }) => {
  const order = await placeWorkedOrder(page, app);
  await page.route('**/api/track/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByText("We couldn't check the current status. This status may be out of date. Your tracking link still works.")).toBeVisible();
  await expect(page.locator('#confirmation-view .status')).toHaveText('● Received');
  await expect(page.locator('#tracking-link')).toHaveValue(`${app.url}/track/${order.private_token}`);
  await expect(page.getByText(/^Current status checked at /)).toHaveCount(0);

  await page.unroute('**/api/track/**');
  await page.getByRole('button', { name: 'Check status again' }).click();
  await expect(page.getByText(/^Current status checked at /)).toBeVisible();
  await expect(page.getByText('This status may be out of date', { exact: false })).toHaveCount(0);
  expect(app.counts().orders).toBe(1);
});

test('A5: when browser storage fails, the confirmation stays usable with explicit save guidance', async ({ page, app }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage disabled', 'QuotaExceededError');
    };
  });
  const order = await placeWorkedOrder(page, app);
  await expect(page.getByText('Save this tracking link before leaving this page.')).toBeVisible();
  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${app.url}/track/${order.private_token}`);
  await expect(page.locator('#tracking-link')).toHaveValue(`${app.url}/track/${order.private_token}`);
  expect(app.counts().orders).toBe(1);
});

test('A5: when copying fails, the link is exposed selected with manual-copy guidance', async ({ page, app }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  const order = await placeWorkedOrder(page, app);
  await page.getByRole('button', { name: 'Copy tracking link' }).click();
  await expect(page.getByText("Copying didn't work. The link above is selected: copy it manually and save it.")).toBeVisible();
  const field = page.locator('#tracking-link');
  await expect(field).toBeFocused();
  const selected = await field.evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd));
  expect(selected).toBe(`${app.url}/track/${order.private_token}`);
  await expect(page.getByText('Anyone with this link can view this order.', { exact: false })).toBeVisible();
});
