import { addWorkedCart, expect, placeOrder, signInAsStaff, staffChange, test } from './fixtures.js';

/** WCAG contrast ratio of each matched element's text against its nearest opaque background. */
async function contrastRatios(page, selector) {
  return page.$$eval(selector, (nodes) => {
    const parse = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]) => {
      const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const background = (node) => {
      for (let el = node; el; el = el.parentElement) {
        const [r, g, b, a = 1] = parse(getComputedStyle(el).backgroundColor);
        if (a > 0.9) return [r, g, b];
      }
      return [255, 255, 255];
    };
    return nodes
      .filter((node) => node.offsetParent !== null && node.textContent.trim())
      .map((node) => {
        const fg = luminance(parse(getComputedStyle(node).color));
        const bg = luminance(background(node));
        return { text: node.textContent.trim().slice(0, 30), ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
      });
  });
}

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function unlabelledControls(page) {
  return page.$$eval('input, textarea, button, select, a[href]', (nodes) =>
    nodes
      .filter((node) => node.offsetParent !== null)
      .filter((node) => {
        const labelled = node.labels?.length > 0 || node.getAttribute('aria-label') || node.getAttribute('aria-labelledby');
        return !labelled && !node.textContent.trim();
      })
      .map((node) => node.outerHTML.slice(0, 80)),
  );
}

test('EXPERIENCE: keyboard ordering keeps focus, shows visible focus and announces errors', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('button', { name: 'Add Chicken casado to cart' });
  await add.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(add).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Quantity for Chicken casado' })).toHaveValue('2');
  // Keyboard focus is visibly outlined.
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth);
  expect(outline).toBe('solid 3px');

  const quantity = page.getByRole('textbox', { name: 'Quantity for Chicken casado' });
  await quantity.fill('two');
  await quantity.press('Enter');
  const error = page.locator('.cart-row').getByRole('alert');
  await expect(error).toHaveText('Enter a whole number greater than zero.');
  await expect(quantity).toHaveAttribute('aria-invalid', 'true');
  await expect(quantity).toHaveAttribute('aria-describedby', /quantity-error-M1/);
  await expect(quantity).toBeFocused();
  expect(await unlabelledControls(page)).toEqual([]);
});

test('EXPERIENCE: automatic staff updates neither erase typed input nor move focus', async ({ page, app }) => {
  const { data } = await placeOrder(app.url);
  const number = data.confirmation.orderNumber;
  await signInAsStaff(page, app);
  const filter = page.getByRole('link', { name: 'Ready', exact: true });
  await filter.focus();
  await placeOrder(app.url);
  await expect(page.locator('.order-card')).toHaveCount(2);
  await expect(filter).toBeFocused();

  await page.goto(`/staff#/orders/${number}?filter=Active`);
  const reason = page.getByLabel('Reason for cancelling (shown to the customer)');
  await reason.click();
  await page.keyboard.type('Ran out of rice');
  await staffChange(app, number, 'Preparing', { username: 'elena' });
  await expect(page.locator('.facts')).toContainText('Preparing');
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue('Ran out of rice');
  await page.keyboard.type(' today');
  await expect(reason).toHaveValue('Ran out of rice today');
  expect(await unlabelledControls(page)).toEqual([]);
});

test('EXPERIENCE: pages reflow at 320px with 200% text and keep readable contrast', async ({ page, app }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
  await page.goto('/');
  await addWorkedCart(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const trackingPath = await page.getByRole('link', { name: 'View order progress' }).getAttribute('href');
  await page.goto(trackingPath);
  await expect(page.getByText('The restaurant has received your order.', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.setViewportSize({ width: 768, height: 1024 });
  await signInAsStaff(page, app);
  await page.locator('.order-card a').first().click();
  await expect(page.getByRole('button', { name: 'Mark Preparing' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('EXPERIENCE: text and controls meet 4.5:1 contrast; status is not conveyed by colour alone', async ({ page, app }) => {
  const { data } = await placeOrder(app.url);
  await page.goto('/');
  const customer = await contrastRatios(page, 'p, h1, h2, h3, .button, .price, .unavailable-label, label');
  expect(customer.length).toBeGreaterThan(30);
  expect(customer.filter((entry) => entry.ratio < 4.5)).toEqual([]);
  await signInAsStaff(page, app);
  await staffChange(app, data.confirmation.orderNumber, 'Preparing');
  await expect(page.locator('.status')).toContainText('Preparing');
  const staff = await contrastRatios(page, 'p, h1, .filter, .status, .order-card span, .button');
  expect(staff.length).toBeGreaterThan(10);
  expect(staff.filter((entry) => entry.ratio < 4.5)).toEqual([]);
  await expect(page.locator('.status').first()).toHaveText(/^\S+ (Received|Preparing|Ready|Collected|Cancelled)$/);
});

test('EXPERIENCE: reduced motion turns off smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('smooth');
});
