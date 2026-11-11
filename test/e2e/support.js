// Shared Playwright setup: every test gets the real app, isolated data and a fresh browser profile.

import assert from 'node:assert/strict';
import playwright from 'playwright';
import { startApp } from '../harness.js';

export const PHONE = { width: 390, height: 780 };
export const TABLET = { width: 900, height: 1100 };

let browser;

export const BROWSER = process.env.E2E_BROWSER ?? 'chromium';

export async function launchBrowser() {
  browser = await playwright[BROWSER].launch();
}
export const closeBrowser = () => browser.close();

/** Runs fn with a fresh app and page. Fails on any page error or console error. */
export function withApp(options, fn) {
  const { viewport = PHONE, at, permissions } = options;
  return async () => {
    const app = await startApp({ at });
    let context;
    try {
      context = await browser.newContext({ viewport, permissions });
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (error) => problems.push(error.message));
      await fn({ app, page, context, problems });
      assert.deepEqual(problems, [], 'page raised errors');
    } finally {
      await context?.close();
      await app.stop();
    }
  };
}

export const orderCount = (app) => app.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
export const body = (page) => page.locator('body');

export async function addDishes(page, app, dishes) {
  await page.goto(app.base);
  for (const [name, times = 1] of dishes) {
    for (let i = 0; i < times; i++) await page.getByRole('button', { name: `Add ${name}` }).click();
  }
}

export async function openCart(page) {
  await page.getByRole('link', { name: /Review cart/ }).click();
  await page.getByRole('heading', { name: 'Your cart' }).waitFor();
}

export const WORKED = [['Chicken casado'], ['Cheese empanada'], ['Iced tea', 2]];
