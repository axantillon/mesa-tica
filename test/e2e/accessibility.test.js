// EXPERIENCE: axe-core scan of every core screen. Automated rules only; not a substitute for assistive-technology testing.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startApp } from '../harness.js';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let browser;
let app;

before(async () => {
  browser = await chromium.launch();
  app = await startApp();
});
after(async () => {
  await browser.close();
  await app.stop();
});

async function scan(page, label) {
  await page.addScriptTag({ content: axeSource });
  const { violations } = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  assert.deepEqual(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`), [], label);
}

test('EXPERIENCE core screens have no automatically detectable WCAG A/AA violations', { timeout: 60_000 }, async () => {
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 390, height: 780 } }); // CSP bypass only so the scanner can load
  const page = await context.newPage();

  await page.goto(app.base);
  await page.getByRole('button', { name: 'Add Horchata' }).click();
  await scan(page, 'menu');

  await page.getByRole('link', { name: /Review cart/ }).click();
  await page.getByRole('heading', { name: 'Your cart' }).waitFor();
  await page.locator('#qty-D1').fill('0');
  await scan(page, 'cart with invalid quantity');
  await page.locator('#qty-D1').fill('1');

  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await page.getByRole('heading', { name: 'Order received' }).waitFor();
  await scan(page, 'confirmation');

  await page.getByRole('link', { name: 'View progress' }).click();
  await page.locator('#status-name').waitFor();
  await scan(page, 'tracking');

  await page.goto(`${app.base}/track/${randomBytes(32).toString('base64url')}`);
  await page.getByText("We couldn't open this tracking link").first().waitFor();
  await scan(page, 'invalid link');

  await page.goto(`${app.base}/staff`);
  await page.getByLabel('Username').fill('luis');
  await page.getByLabel('Password').fill(app.credentials.luis);
  await scan(page, 'sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#order-1001').waitFor();
  await scan(page, 'queue');

  await page.locator('#order-1001').click();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await scan(page, 'detail with reason form');
  await page.getByLabel('Reason for cancelling').fill('Out of rice');
  await page.getByRole('button', { name: 'Review cancellation' }).click();
  await scan(page, 'cancel confirmation dialog');

  await context.close();
});
