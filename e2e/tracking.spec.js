import { expect, placeOrder, staffChange, test } from './fixtures.js';

const STALE = 'Updates are unavailable. This status may be out of date.';

async function orderWithLink(app) {
  const { data } = await placeOrder(app.url);
  return data.confirmation;
}

const lastCheckText = async (page) => (await page.locator('.last-check').textContent()).trim();

test('C1/C2/C3: tracking updates automatically, shows guidance per status, warns when stale and recovers', async ({ page, app }) => {
  const order = await orderWithLink(app);
  await page.goto(order.trackingPath);
  await expect(page.getByRole('heading', { name: `Order ${order.orderNumber}` })).toBeVisible();
  await expect(page.getByText('The restaurant has received your order. It is not ready for pickup yet.')).toBeVisible();
  await expect(page.getByText(/^Placed Tue, Nov 10, 12:0\d PM$/)).toBeVisible();
  await expect(page.locator('main')).toContainText('2 × Iced tea (₡1,000 each) — ₡2,000');
  await expect(page.locator('main .total')).toHaveText('Total ₡7,900');
  await expect(page.locator('.last-check')).toHaveText(/^Last checked: \d{1,2}:\d{2}:\d{2} [AP]M$/);
  await expect(page.locator('.pickup')).toHaveCount(0);

  await staffChange(app, order.orderNumber, 'Preparing');
  await expect(page.getByText('Your meal is being prepared. It is not ready for pickup yet.')).toBeVisible();
  await expect(page.locator('.pickup')).toHaveCount(0);

  await staffChange(app, order.orderNumber, 'Ready');
  await expect(page.getByText('Your order is ready for pickup.')).toBeVisible();
  await expect(page.locator('.pickup')).toContainText(`Show order number ${order.orderNumber} at the counter.`);
  await expect(page.locator('.pickup')).toContainText('Pickup location: Mesa Tica pickup counter');
  await expect(page.locator('.pickup')).toContainText('Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.');
  await expect(page.locator('.pickup')).toContainText('Pay at collection.');

  // Updates fail: the last known Ready status stays visible with an unmistakable warning and its check time.
  const beforeFailure = await lastCheckText(page);
  await page.route('**/api/track/**', (route) => route.abort('internetdisconnected'));
  await expect(page.getByRole('alert')).toContainText(STALE);
  const checkedAt = beforeFailure.replace('Last checked: ', '');
  await expect(page.getByRole('alert')).toContainText(`Last checked ${checkedAt}.`);
  await expect(page.locator('.status-line')).toHaveText('Status: ✔ Ready (last known)');
  await expect(page.locator('.last-check')).toHaveText(`Last successful check: ${checkedAt}`);

  // While offline, staff marks it collected; recovery must fetch it before clearing the warning.
  await staffChange(app, order.orderNumber, 'Collected');
  await page.waitForTimeout(1200);
  await expect(page.getByRole('alert')).toContainText(STALE);
  await page.unroute('**/api/track/**');
  await expect(page.getByText('This order has been collected. No further pickup action is needed.')).toBeVisible();
  await expect(page.getByText(STALE)).toHaveCount(0);
  await expect(page.locator('.pickup')).toHaveCount(0);
  expect(await lastCheckText(page)).not.toBe(beforeFailure);
});

test('C2: an initial failure shows no fabricated status or check time and is not called an invalid link', async ({ page, app }) => {
  const order = await orderWithLink(app);
  await page.route('**/api/track/**', (route) => route.abort('timedout'));
  await page.goto(order.trackingPath);
  await expect(page.getByRole('heading', { name: 'Updates are unavailable' })).toBeVisible();
  await expect(page.getByText('not a problem with your link', { exact: false })).toBeVisible();
  await expect(page.getByText(/Status:|Last checked|Received/)).toHaveCount(0);
  await expect(page.getByText("We couldn't open this tracking link")).toHaveCount(0);
  await page.unroute('**/api/track/**');
  await expect(page.getByText('The restaurant has received your order. It is not ready for pickup yet.')).toBeVisible();
});

test('C1: invalid links and guessed order numbers disclose no order data', async ({ page, app }) => {
  const order = await orderWithLink(app);
  for (const path of [`/track/${order.orderNumber}`, `/track/${'A'.repeat(32)}`, '/track/', `${order.trackingPath.slice(0, -1)}x`]) {
    await page.goto(path);
    await expect(page.getByText("We couldn't open this tracking link. Check the full saved link.")).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Chicken casado');
    await expect(page.locator('main')).not.toContainText('₡');
  }
});

test('C3: a cancelled order shows the exact reason and labelled demo contact, with no staff identity', async ({ page, app }) => {
  const order = await orderWithLink(app);
  await page.goto(order.trackingPath);
  await expect(page.getByText('The restaurant has received your order.', { exact: false })).toBeVisible();
  await staffChange(app, order.orderNumber, 'Cancelled', { reason: 'Our fryer broke, sorry!', username: 'luis' });
  await expect(page.getByText('This order was cancelled. It will not be prepared or collected.')).toBeVisible();
  await expect(page.locator('.cancel-reason')).toHaveText('Our fryer broke, sorry!');
  await expect(page.locator('.cancelled')).toContainText('Contact: demo-contact@example.invalid (Demo contact — not monitored)');
  await expect(page.locator('body')).not.toContainText('Luis');
  await expect(page.locator('body')).not.toContainText('Elena');

  // Stale warnings stay clear for every status, including final ones.
  await page.route('**/api/track/**', (route) => route.abort('failed'));
  await expect(page.getByRole('alert')).toContainText(STALE);
  await expect(page.locator('.status-line')).toHaveText('Status: ✕ Cancelled (last known)');
});
