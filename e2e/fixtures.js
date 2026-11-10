import { test as base, expect } from '@playwright/test';
import { TIMES, WORKED_SELECTION, api, placeOrder, signIn, startTestServer } from '../test/support/harness.js';

/**
 * `app`: a fresh Mesa Tica instance per test (own SQLite file, generated staff credentials, test clock set
 * to an open time). Tests assert durable outcomes directly against app.db / app.counts().
 */
export const test = base.extend({
  app: async ({}, use, testInfo) => {
    const app = await startTestServer({ dataDir: testInfo.outputPath('data'), clockAt: TIMES.open });
    await use(app);
    await app.close();
  },
  baseURL: async ({ app }, use) => {
    await use(app.url);
  },
});

export { expect, TIMES, WORKED_SELECTION, api, placeOrder, signIn };

/** Adds the worked-example cart: 1 Chicken casado, 1 Cheese empanada, 2 Iced teas (₡7,900). */
export async function addWorkedCart(page) {
  await page.getByRole('button', { name: 'Add Chicken casado to cart' }).click();
  await page.getByRole('button', { name: 'Add Cheese empanada to cart' }).click();
  await page.getByRole('button', { name: 'Add Iced tea to cart' }).click();
  await page.getByRole('button', { name: 'Add Iced tea to cart' }).click();
  await expect(cartTotal(page)).toHaveText('Total ₡7,900');
}

export const cartTotal = (page) => page.locator('#cart .total');

/** Changes an order's status through the staff API as another employee. */
export async function staffChange(app, number, target, { reason, username = 'elena' } = {}) {
  const cookie = await signIn(app.url, username, app.credentials[username]);
  const current = await api(app.url, `/api/staff/orders/${number}`, { cookie });
  const response = await api(app.url, `/api/staff/orders/${number}/status`, {
    method: 'POST',
    cookie,
    body: { revision: current.data.order.revision, target, reason },
  });
  if (response.status !== 200) throw new Error(`Staff change failed: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data.order;
}

export async function signInAsStaff(page, app, username = 'luis') {
  await page.goto('/staff');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(app.credentials[username]);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}
