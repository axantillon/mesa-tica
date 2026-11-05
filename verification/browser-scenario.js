async (page, origin, credentials) => {
  const checks = [];
  const require = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const seen = (locator) => locator.waitFor({ state: 'visible', timeout: 6500 });
  const gone = (locator) => locator.waitFor({ state: 'hidden', timeout: 6500 });
  const button = (view, name) => view.getByRole('button', { name, exact: true });
  const heading = (view, name) => view.getByRole('heading', { name, exact: true });
  const open = (view, path) => view.goto(origin + path);
  const browser = page.context().browser();
  const operations = browser ? await browser.newContext({ viewport: { width: 1024, height: 768 } }) : page.context();
  const staff = await operations.newPage();
  const report = (name) => checks.push('BROWSER PASS ' + name);

  async function signIn(view, username) {
    await view.getByLabel('Username').fill(username);
    await view.getByLabel('Password').fill(credentials[username]);
    await button(view, 'Sign in').click();
  }
  async function noOverflow(view, description) {
    require(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), description);
  }
  async function showCart() {
    await page.getByRole('link', { name: /^View cart/ }).click();
    require(await heading(page, 'Your cart').evaluate((node) => node === document.activeElement), 'cart shortcut moves focus');
  }

  await open(staff, '/staff');
  await staff.getByLabel('Username').fill('luis');
  await staff.getByLabel('Password').fill('wrong');
  await button(staff, 'Sign in').click();
  await seen(staff.getByText(/Check your credentials/));
  let brokenAuth = true;
  await staff.route('**/api/staff/sign-in', (route) => brokenAuth ? route.abort('failed') : route.continue());
  await signIn(staff, 'luis');
  await seen(staff.getByText(/Couldn't reach sign-in/));
  brokenAuth = false;
  await signIn(staff, 'luis');
  await seen(staff.getByText('No active orders.'));
  report('staff sign-in distinguishes bad credentials, connection failure and an empty queue');

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/');
  await seen(page.getByText('Open for pickup'));
  const fish = page.getByRole('listitem').filter({ has: heading(page, 'Fish casado') });
  await seen(fish.getByText('Unavailable'));
  require(await fish.getByRole('button').count() === 0, 'unavailable fish has no Add action');
  require(await button(page, 'Place pickup order').isDisabled(), 'empty cart blocks submission');
  await noOverflow(page, 'phone menu must not overflow');

  const chicken = button(page, 'Add Chicken casado');
  await chicken.focus();
  await chicken.press('Space');
  await button(page, 'Add Cheese empanada').click();
  await button(page, 'Add Iced tea').click();
  await seen(page.getByLabel('Iced tea quantity'));
  await button(page, 'Add Iced tea').click();
  await showCart();
  const total = page.locator('#cart .total strong');
  const tea = page.getByLabel('Iced tea quantity');
  require(await tea.inputValue() === '2' && await total.textContent() === '₡7,900', 'duplicate Add and worked ₡7,900 total');
  await tea.fill('3');
  await seen(total.filter({ hasText: '₡8,900' }));
  for (const value of ['0', '-1', '1.5', 'x']) {
    await tea.fill(value);
    await seen(page.locator('#qty-D2'));
    require(await page.locator('#qty-D2').textContent() === 'Enter a whole number greater than zero.', 'quantity has field correction');
    require(await tea.inputValue() === value, 'invalid quantity remains visible');
    require(await button(page, 'Place pickup order').isDisabled(), 'invalid quantity blocks submission');
  }
  await tea.fill('2');
  await button(page, 'Remove Cheese empanada').click();
  await seen(total.filter({ hasText: '₡6,500' }));
  await page.reload();
  await seen(total.filter({ hasText: '₡6,500' }));
  await button(page, 'Add Cheese empanada').click();
  await seen(total.filter({ hasText: '₡7,900' }));
  report('phone cart supports keyboard, exact totals, corrections, removal and reload');

  let altered = true;
  let closed = false;
  await page.route('**/api/menu', async (route) => {
    if (!altered && !closed) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (altered) {
      body.menu.find((dish) => dish.code === 'M1').price = 4600;
      body.menu.find((dish) => dish.code === 'S2').available = 0;
    }
    if (closed) body.opening = { open: false, next: { date: '2026-11-06', time: '10:00' } };
    await route.fulfill({ response, json: body });
  });
  await seen(page.getByText(/Cheese empanada is no longer available/));
  require(await button(page, 'Place pickup order').isDisabled(), 'changed menu blocks placement');
  await button(page, 'Review updated prices').click();
  await seen(total.filter({ hasText: '₡8,000' }));
  require(await button(page, 'Place pickup order').isDisabled(), 'unavailable item still blocks after price review');
  altered = false;
  await seen(page.getByText(/Chicken casado is now ₡4,500/));
  await button(page, 'Review updated prices').click();
  await seen(total.filter({ hasText: '₡7,900' }));
  closed = true;
  await seen(page.locator('#opening').filter({ hasText: 'Opens Friday, Nov 6 at 10:00 AM' }));
  require(await button(page, 'Place pickup order').isDisabled(), 'closed menu blocks submission');
  await button(page, 'Add Horchata').click();
  await seen(total.filter({ hasText: '₡9,200' }));
  await button(page, 'Remove Horchata').click();
  closed = false;
  await seen(page.getByText('Open for pickup'));
  report('menu changes require review, and closed browsing permits cart edits');

  let lost = false;
  const dropCheckoutResponse = async (route) => {
    const response = await route.fetch();
    lost = (await response.json()).outcome === 'accepted';
    await route.abort('failed');
  };
  await page.route('**/api/checkout/submit', dropCheckoutResponse);
  await button(page, 'Place pickup order').click();
  await seen(page.getByText(/We couldn't confirm the result/));
  require(lost, 'upstream accepted before browser lost response');
  await page.reload();
  await seen(button(page, 'Check order'));
  require(await button(page, 'Place pickup order').count() === 0, 'pending attempt blocks a fresh order');
  await button(page, 'Check order').click();
  await seen(heading(page, 'Order received'));
  await seen(page.getByText('Pay at collection.', { exact: true }));
  await seen(page.getByText(/Anyone with the link/));
  await page.unroute('**/api/checkout/submit');
  const trackingPath = await page.getByRole('link', { name: 'View order progress' }).getAttribute('href');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await button(page, 'Copy tracking link').click();
  await seen(page.getByText('Link copied', { exact: true }));
  require(await page.evaluate(() => navigator.clipboard.readText()) === origin + trackingPath, 'clipboard contains the private link');
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard denied'));
  });
  await button(page, 'Copy tracking link').click();
  await seen(page.getByText('Copy the selected link manually.'));
  require(await page.getByLabel('Private tracking link').inputValue() === origin + trackingPath, 'manual fallback has full link');
  await button(page, 'Back to menu').click();
  await seen(page.getByText(/Your cart is empty/));
  report('lost accepted response recovers after reload; copy, manual fallback and cart clearing work');

  const guestContext = browser ? await browser.newContext({ viewport: { width: 390, height: 844 } }) : page.context();
  const track = await guestContext.newPage();
  let trackOffline = true;
  await track.route('**/api/track/**', (route) => trackOffline ? route.abort('failed') : route.continue());
  await open(track, trackingPath);
  await seen(track.getByText('Updates are unavailable. Trying again…'));
  require(await track.locator('#checked').isHidden(), 'first tracking failure has no successful timestamp');
  require(await track.getByText('Received', { exact: true }).count() === 0, 'first tracking failure has no invented status');
  trackOffline = false;
  await seen(track.getByText(/The restaurant has received your order/));
  await seen(staff.getByRole('link', { name: /Order #0001/ }));
  await noOverflow(track, 'phone tracking must not overflow');

  let queueOffline = true;
  await staff.route('**/api/staff/orders?filter=Active', (route) => queueOffline ? route.abort('failed') : route.continue());
  const queueChecked = await staff.locator('#staff-checked').textContent();
  await seen(staff.getByText(/This information may be out of date/));
  require(await staff.locator('#staff-checked').textContent() === queueChecked, 'queue failure retains last successful time');
  await seen(staff.getByRole('link', { name: /Order #0001/ }));
  queueOffline = false;
  await gone(staff.getByText(/This information may be out of date/));
  await staff.getByLabel('Show orders').selectOption('Received');
  await staff.getByRole('link', { name: /Order #0001/ }).click();
  await seen(heading(staff, 'Accepted items'));
  await noOverflow(staff, 'tablet staff detail must not overflow');
  await seen(staff.getByText('₡7,900', { exact: true }));

  let firstWrite = true;
  await staff.route('**/api/staff/orders/1', async (route) => {
    if (route.request().method() !== 'POST' || !firstWrite) return route.continue();
    firstWrite = false;
    const response = await route.fetch();
    require(response.status() === 200, 'staff write reached server');
    await route.abort('failed');
  });
  await button(staff, 'Mark Preparing').click();
  await seen(staff.getByText(/We couldn't confirm the change/));
  await seen(staff.getByText('Received → Preparing'));
  await seen(track.getByText(/Your meal is being prepared/));
  await button(staff, 'Mark Ready').click();
  await seen(track.getByText('Your order is ready for pickup.'));
  await seen(track.getByText(/Collect at the Mesa Tica pickup counter/));
  trackOffline = true;
  const trackingChecked = await track.locator('#checked').textContent();
  await seen(track.getByText(/This status may be out of date/));
  require(await track.locator('#checked').textContent() === trackingChecked, 'tracking failure retains last successful time');
  await seen(track.getByText('Your order is ready for pickup.'));
  await button(staff, 'Mark Collected').click();
  await seen(staff.getByText('Order marked Collected.'));
  trackOffline = false;
  await seen(track.getByText('This order has been collected.'));
  await gone(track.getByText(/This status may be out of date/));
  await gone(track.getByText(/Collect at the Mesa Tica pickup counter/));
  await staff.getByRole('link', { name: 'Back to queue' }).click();
  await seen(staff.getByLabel('Show orders'));
  require(await staff.getByLabel('Show orders').inputValue() === 'Received', 'detail returns to previous filter');
  await seen(staff.getByText('No orders match this filter.'));
  await staff.getByLabel('Show orders').selectOption('Collected');
  await seen(staff.getByRole('link', { name: /Order #0001/ }));
  report('queue and tracking poll, preserve stale snapshots, recover current status and retain the filter');

  await button(page, 'Add Horchata').click();
  await page.route('**/api/checkout/submit', dropCheckoutResponse);
  await button(page, 'Place pickup order').click();
  await seen(page.getByText(/We couldn't confirm the result/));
  await staff.getByLabel('Show orders').selectOption('Active');
  await staff.getByRole('link', { name: /Order #0002/ }).click();
  await button(staff, 'Cancel order').click();
  const reason = 'Ingredients are unavailable.\nWe cannot prepare this order.';
  await staff.getByLabel('Cancellation reason').fill(reason);
  await button(staff, 'Keep order').click();
  await seen(staff.getByText('No staff changes yet.'));
  await button(staff, 'Cancel order').click();
  require(await staff.getByLabel('Cancellation reason').inputValue() === reason, 'dismissal preserves cancellation reason');
  const separate = await guestContext.request.post(origin + '/api/staff/sign-in', {
    data: { username: 'elena', password: credentials.elena },
  });
  require(separate.status() === 200, 'Elena signed in separately');
  const competitor = await guestContext.request.post(origin + '/api/staff/orders/2', {
    data: { revision: 0, target: 'Preparing' },
  });
  require(competitor.status() === 200, 'Elena changed the order while Luis was confirming');
  await seen(staff.locator('#staff-content .status-preparing'));
  require(await staff.getByLabel('Cancellation reason').inputValue() === reason, 'refresh preserves draft reason');
  await button(staff, 'Confirm cancellation').click();
  await seen(staff.getByText(/This order changed to Preparing/));
  await button(staff, 'Cancel order').click();
  require(await staff.getByLabel('Cancellation reason').inputValue() === reason, 'conflict preserves draft for a deliberate retry');
  await button(staff, 'Confirm cancellation').click();
  await seen(staff.getByText('Order marked Cancelled.'));
  await button(page, 'Check order').click();
  await seen(heading(page, 'Order cancelled'));
  await gone(page.getByText('Pay at collection.', { exact: true }));
  const otherTrackingPath = await page.getByRole('link', { name: 'View order progress' }).getAttribute('href');
  require(otherTrackingPath !== trackingPath, 'a deliberate new order has a different private link');
  await open(track, otherTrackingPath);
  await seen(track.getByText('This order was cancelled.'));
  await seen(track.getByText('Demo contact — not monitored', { exact: false }));
  require(await track.locator('.reason').textContent() === reason, 'public cancellation reason matches exactly');
  require(await track.getByText('Luis', { exact: false }).count() === 0, 'tracking hides staff identity');
  report('cancellation dismissal, pinned revision, preserved reason and customer recovery after cancellation');

  await open(track, '/track/2');
  await seen(track.getByText(/Check the full saved link/));
  require(await track.getByText('Cancelled', { exact: true }).count() === 0, 'guessed number does not reveal order');
  let staffExpired = true;
  await staff.route('**/api/staff/orders/2', (route) => staffExpired && route.request().method() === 'GET'
    ? route.fulfill({ status: 401, json: { error: 'sign_in_required' } }) : route.continue());
  await seen(staff.getByText(/Staff access expired/));
  require(await staff.getByText('Order marked Cancelled.').isHidden(), 'expired view hides staff data');
  staffExpired = false;
  await signIn(staff, 'luis');
  await seen(staff.getByText('Preparing → Cancelled'));
  await button(staff, 'Sign out').click();
  await seen(staff.getByText('Signed out.'));
  report('invalid private link, expired staff access, reauthentication and sign-out');

  if (browser) await Promise.all([guestContext.close(), operations.close()]);
  return checks;
}
