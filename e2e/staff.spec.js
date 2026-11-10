import { api, expect, placeOrder, signInAsStaff, staffChange, test } from './fixtures.js';

const card = (page, number) => page.locator(`[data-order-number="${number}"]`);
const STALE = 'Updates are unavailable. This information may be out of date.';

async function newOrder(app, selection) {
  const { data } = await placeOrder(app.url, selection ? { selection } : {});
  return data.confirmation.orderNumber;
}

test('B1: failed sign-in is generic and distinct from a connection failure', async ({ page, app }) => {
  await page.goto('/staff');
  await page.getByLabel('Username').fill('luis');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText("We couldn't sign you in. Check your credentials and try again.");

  await page.route('**/api/staff/session', (route) => route.abort('failed'));
  await page.getByLabel('Password').fill(app.credentials.luis);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    "We couldn't reach the sign-in service. Check your connection and try again. Your credentials were not rejected.",
  );
  await expect(page.locator('#workspace')).toBeHidden();
});

test('B1/B2: Active queue oldest first, automatic updates, filters, detail and return preserve the filter', async ({ page, app }) => {
  await signInAsStaff(page, app, 'luis');
  await expect(page.getByText('No active orders.')).toBeVisible();
  await expect(page.locator('.last-refresh')).toHaveText(/^Last successful refresh \d{1,2}:\d{2}:\d{2} [AP]M$/);

  const first = await newOrder(app);
  const second = await newOrder(app, [{ code: 'M2', quantity: 2, reviewedPrice: 4000 }]);
  await expect(card(page, first)).toBeVisible();
  await expect(card(page, second)).toBeVisible();
  await expect(page.locator('.order-card a')).toHaveCount(2);
  expect(await page.locator('.order-card a').evaluateAll((links) => links.map((link) => Number(link.dataset.orderNumber)))).toEqual([first, second]);
  await expect(card(page, second)).toContainText('2 × Vegetarian casado');
  await expect(card(page, second)).toContainText('Received');

  // Another employee's change appears automatically.
  await staffChange(app, second, 'Preparing', { username: 'elena' });
  await expect(card(page, second)).toContainText('Preparing');

  await page.getByRole('link', { name: 'Received', exact: true }).click();
  await expect(page).toHaveURL(/filter=Received/);
  await expect(page.locator('.order-card a')).toHaveCount(1);
  await card(page, first).click();

  await expect(page.getByRole('heading', { name: `Order ${first}` })).toBeVisible();
  await expect(page.locator('table.items tbody tr')).toHaveText([
    'Chicken casado1₡4,500₡4,500',
    'Cheese empanada1₡1,400₡1,400',
    'Iced tea2₡1,000₡2,000',
  ]);
  await expect(page.locator('table.items tfoot')).toHaveText('Total₡7,900');
  await expect(page.locator('.facts')).toContainText(/Submitted\s*Tue, Nov 10, 12:0\d PM/);
  await expect(page.getByRole('button', { name: 'Mark Preparing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Ready' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(page.getByText(`Order ${first} is now Preparing.`)).toBeVisible();
  await expect(page.locator('.history')).toContainText('Received → Preparing by Luis — Tue, Nov 10');
  await page.getByRole('button', { name: 'Mark Ready' }).click();
  await expect(page.getByText(`Order ${first} is now Ready.`)).toBeVisible();
  await page.getByRole('button', { name: 'Mark Collected' }).click();
  await expect(page.getByText(`This order is Collected, which is final. No further changes are possible.`)).toBeVisible();
  await expect(page.locator('.detail-view button:visible')).toHaveCount(0);
  await expect(page.locator('#cancel-form')).toBeHidden();

  await page.getByRole('link', { name: '← Back to Received orders' }).click();
  await expect(page).toHaveURL(/#\/orders\?filter=Received$/);
  await expect(page.getByText('No orders match this filter.')).toBeVisible();
  await page.getByRole('link', { name: 'Active', exact: true }).click();
  await expect(page.locator('.order-card a')).toHaveCount(1);
  await expect(card(page, first)).toHaveCount(0);
  await page.getByRole('link', { name: 'Collected', exact: true }).click();
  await expect(card(page, first)).toBeVisible();
  await page.getByRole('link', { name: 'All', exact: true }).click();
  await expect(page.locator('.order-card a')).toHaveCount(2);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('You have signed out.')).toBeVisible();
  await expect(page.locator('#workspace')).toBeEmpty();
  expect((await api(app.url, '/api/staff/session')).status).toBe(401);
});

test('B1-STALE: refresh failures keep the last queue and time with a warning; recovery clears it after current data', async ({ page, app }) => {
  const number = await newOrder(app);
  await signInAsStaff(page, app);
  await expect(card(page, number)).toBeVisible();
  const lastRefresh = (await page.locator('.last-refresh').textContent()).replace('Last successful refresh ', '');

  await page.route('**/api/staff/orders?*', (route) => route.abort('internetdisconnected'));
  await expect(page.getByRole('alert')).toContainText(STALE);
  await expect(page.getByRole('alert')).toContainText(`Last successful refresh ${lastRefresh}.`);
  await expect(card(page, number)).toBeVisible();

  const added = await newOrder(app);
  await page.waitForTimeout(1200);
  await expect(card(page, added)).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(STALE);

  await page.unroute('**/api/staff/orders?*');
  await expect(card(page, added)).toBeVisible();
  await expect(page.getByText(STALE)).toHaveCount(0);
  await expect(page.locator('.last-refresh')).not.toHaveText(`Last successful refresh ${lastRefresh}`);
});

test('B1: an initial load failure is distinct from an empty queue', async ({ page, app }) => {
  await page.route('**/api/staff/orders?*', (route) => route.abort('failed'));
  await signInAsStaff(page, app);
  await expect(page.getByText("We couldn't load orders. This is a connection or service problem.", { exact: false })).toBeVisible();
  await expect(page.getByText('No active orders.')).toHaveCount(0);
  await page.unroute('**/api/staff/orders?*');
  await expect(page.getByText('No active orders.')).toBeVisible();
});

test('B3: cancellation needs a reason and confirmation; dismissal changes nothing and keeps the reason', async ({ page, app }) => {
  const number = await newOrder(app);
  await signInAsStaff(page, app);
  await card(page, number).click();
  const reason = page.getByLabel('Reason for cancelling (shown to the customer)');

  await page.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.locator('#cancel-reason-error')).toHaveText('Enter a reason for cancelling. The customer will see it.');
  await expect(reason).toBeFocused();
  await reason.fill('   ');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await reason.fill('We ran out of plantain.');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Cancel order ${number}? The customer will see this reason.`);
  await expect(dialog).toContainText('We ran out of plantain.');
  await expect(page.getByRole('button', { name: 'Keep order' })).toBeFocused();
  await page.getByRole('button', { name: 'Keep order' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeFocused();
  await expect(reason).toHaveValue('We ran out of plantain.');
  expect(app.counts().statusChanges).toBe(0);

  // Escape also dismisses.
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(app.counts().statusChanges).toBe(0);

  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('button', { name: 'Yes, cancel order' }).click();
  await expect(page.getByText(`Order ${number} is now Cancelled.`)).toBeVisible();
  await expect(page.locator('.panel.cancelled')).toContainText('We ran out of plantain.');
  await expect(page.locator('.history')).toContainText('Received → Cancelled by Luis');
  expect(app.counts().statusChanges).toBe(1);
  const tracking = await api(app.url, `/api/track/${app.db.prepare('SELECT private_token FROM orders').get().private_token}`);
  expect(tracking.data.guidance.reason).toBe('We ran out of plantain.');
});

test('B3-CONFLICT: refresh during confirmation keeps the chosen revision; the conflict is explained and recovery is deliberate', async ({ page, app }) => {
  const number = await newOrder(app);
  await signInAsStaff(page, app, 'luis');
  await card(page, number).click();
  await page.getByLabel('Reason for cancelling (shown to the customer)').fill('Fryer is broken.');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Elena changes the order while Luis is confirming; several background refreshes happen meanwhile.
  await staffChange(app, number, 'Preparing', { username: 'elena' });
  await page.waitForTimeout(1600);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, cancel order' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'changed before your update was saved' })).toHaveText(
    `Order ${number} changed before your update was saved. It is now Preparing. Review the current order before choosing another action.`,
  );
  await expect(page.locator('.facts')).toContainText('Preparing');
  await expect(page.locator('.history li')).toHaveCount(2);
  await expect(page.locator('.history')).toContainText('Received → Preparing by Elena');
  await expect(page.getByLabel('Reason for cancelling (shown to the customer)')).toHaveValue('Fryer is broken.');
  expect(app.db.prepare('SELECT status FROM orders WHERE number = ?').get(number).status).toBe('Preparing');
  expect(app.counts().statusChanges).toBe(1);

  // No automatic resubmission happened; a new deliberate choice against the current state succeeds.
  await page.waitForTimeout(1200);
  expect(app.counts().statusChanges).toBe(1);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('button', { name: 'Yes, cancel order' }).click();
  await expect(page.getByText(`Order ${number} is now Cancelled.`)).toBeVisible();
  expect(app.counts().statusChanges).toBe(2);
});

test('B3-CONFLICT: two employees choose Mark Preparing from the same state; one succeeds, the other sees the current state', async ({ browser, app }) => {
  const number = await newOrder(app);
  const luisContext = await browser.newContext({ baseURL: app.url });
  const elenaContext = await browser.newContext({ baseURL: app.url });
  const luisPage = await luisContext.newPage();
  const elenaPage = await elenaContext.newPage();
  await signInAsStaff(luisPage, app, 'luis');
  await signInAsStaff(elenaPage, app, 'elena');
  await luisPage.goto(`/staff#/orders/${number}?filter=Active`);
  await elenaPage.goto(`/staff#/orders/${number}?filter=Active`);
  await expect(luisPage.getByRole('button', { name: 'Mark Preparing' })).toBeVisible();
  await expect(elenaPage.getByRole('button', { name: 'Mark Preparing' })).toBeVisible();

  // Hold Elena's background detail reads so her view still shows the state both employees observed.
  const held = [];
  await elenaPage.route(`**/api/staff/orders/${number}`, (route) => held.push(route));

  await luisPage.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(luisPage.getByText(`Order ${number} is now Preparing.`)).toBeVisible();
  await elenaPage.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(elenaPage.getByRole('alert').filter({ hasText: 'changed before your update was saved' })).toBeVisible();
  await expect(elenaPage.locator('.facts')).toContainText('Preparing');
  await expect(elenaPage.getByRole('button', { name: 'Mark Ready' })).toBeVisible();
  await expect(elenaPage.locator('.history')).toContainText('Received → Preparing by Luis');

  expect(app.counts().statusChanges).toBe(1);
  await elenaPage.unroute(`**/api/staff/orders/${number}`);
  for (const route of held) await route.continue().catch(() => {});
  await luisContext.close();
  await elenaContext.close();
});

test('B3-CONFLICT: refresh failure and reauthentication keep the same-order draft; no protected data while signed out', async ({ page, app }) => {
  const number = await newOrder(app);
  const other = await newOrder(app);
  await signInAsStaff(page, app, 'luis');
  await card(page, number).click();
  const reason = page.getByLabel('Reason for cancelling (shown to the customer)');
  await reason.fill('Supplier delivery missed.');

  // Refresh failure: stale warning, actions paused, draft kept and no claim of success.
  await page.route(`**/api/staff/orders/${number}`, (route) => route.abort('internetdisconnected'));
  await expect(page.getByRole('alert').filter({ hasText: STALE })).toBeVisible();
  await expect(page.getByText('Actions are paused because this order may be out of date.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeDisabled();
  await expect(reason).toHaveValue('Supplier delivery missed.');
  await page.unroute(`**/api/staff/orders/${number}`);
  await expect(page.getByText(STALE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeEnabled();

  // Access expires on the server: the next refresh asks for sign-in and removes protected data.
  app.revokeAllSessions();
  await expect(page.getByText('Your staff session has ended. Sign in to continue.', { exact: false })).toBeVisible();
  await expect(page.getByText(`Your cancellation reason for order ${number} is kept in this tab.`, { exact: false })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Chicken casado');
  await expect(page.locator('body')).not.toContainText('₡7,900');
  await expect(page.locator('#workspace')).toBeEmpty();
  expect(app.counts().statusChanges).toBe(0);

  // After signing in again, the same order is fetched, the draft restored and a new deliberate action required.
  await page.getByLabel('Username').fill('luis');
  await page.getByLabel('Password').fill(app.credentials.luis);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: `Order ${number}` })).toBeVisible();
  await expect(reason).toHaveValue('Supplier delivery missed.');
  await expect(page.getByText(`Your cancellation reason for order ${number} was kept.`, { exact: false })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(app.counts().statusChanges).toBe(0);

  // The draft belongs to this order only.
  await page.goto(`/staff#/orders/${other}?filter=Active`);
  await expect(page.getByRole('heading', { name: `Order ${other}` })).toBeVisible();
  await expect(reason).toHaveValue('');
  await page.goto(`/staff#/orders/${number}?filter=Active`);
  await expect(reason).toHaveValue('Supplier delivery missed.');

  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('button', { name: 'Yes, cancel order' }).click();
  await expect(page.getByText(`Order ${number} is now Cancelled.`)).toBeVisible();
  expect(app.db.prepare('SELECT status FROM orders WHERE number = ?').get(number).status).toBe('Cancelled');
  expect(app.db.prepare('SELECT status FROM orders WHERE number = ?').get(other).status).toBe('Received');
});

test('B3: an uncertain write refreshes actual state and is never repeated automatically', async ({ page, app }) => {
  const number = await newOrder(app);
  await signInAsStaff(page, app);
  await card(page, number).click();
  let posts = 0;
  await page.route(`**/api/staff/orders/${number}/status`, async (route) => {
    posts += 1;
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Mark Preparing' }).click();
  await expect(page.getByText("We couldn't confirm whether this change was saved.", { exact: false })).toBeVisible();
  await expect(page.locator('.facts')).toContainText('Preparing');
  await expect(page.locator('.history')).toContainText('Received → Preparing by Luis');
  await page.waitForTimeout(1200);
  expect(posts).toBe(1);
  expect(app.counts().statusChanges).toBe(1);
});
