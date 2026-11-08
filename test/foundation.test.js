import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoursLabel, isOpen, nextOpening } from '../src/policies.js';
import { RESTAURANT } from '../src/seed.js';
import { openStores } from '../src/store.js';
import { runSetup } from '../src/setup.js';
import { costaRica, freshDataDir, readCredentials, removeDataDir, startApp } from './harness.js';

test('A1 opening is inclusive, closing exclusive, in restaurant-local time', () => {
  assert.equal(isOpen(RESTAURANT, costaRica(9, 9, 59, 59)), false);
  assert.equal(isOpen(RESTAURANT, costaRica(9, 10, 0, 0)), true);
  assert.equal(isOpen(RESTAURANT, costaRica(9, 20, 59, 59)), true);
  assert.equal(isOpen(RESTAURANT, costaRica(9, 21, 0, 0)), false);
});

test('A1 next opening is today before opening and tomorrow after closing, in local dates', () => {
  assert.equal(nextOpening(RESTAURANT, costaRica(9, 7)), 'Monday, November 9, 10:00 AM');
  assert.equal(nextOpening(RESTAURANT, costaRica(9, 22)), 'Tuesday, November 10, 10:00 AM');
  // 23:30 local on Monday is already Tuesday in UTC; the label still follows the restaurant.
  assert.equal(nextOpening(RESTAURANT, costaRica(9, 23, 30)), 'Tuesday, November 10, 10:00 AM');
});

test('A1 a schedule with no opening invents no reopening; one weekly opening wraps a full week', () => {
  const never = { ...RESTAURANT, openingHours: Array(7).fill(null) };
  assert.equal(nextOpening(never, costaRica(9, 12)), null);
  assert.equal(isOpen(never, costaRica(9, 12)), false);
  const mondaysOnly = { ...RESTAURANT, openingHours: [null, { open: 600, close: 720 }, null, null, null, null, null] };
  assert.equal(nextOpening(mondaysOnly, costaRica(9, 13)), 'Monday, November 16, 10:00 AM');
});

test('A1 the supplied hours read as the document states them', () => {
  assert.equal(hoursLabel(RESTAURANT), 'Monday through Sunday, 10:00 AM to 9:00 PM');
});

test('SETUP is repeatable: no duplicate menu, no password reset, no customer orders', () => {
  const dataDir = freshDataDir();
  const first = runSetup(dataDir);
  assert.deepEqual(first.created, ['luis', 'elena']);
  const credentials = readCredentials(dataDir);
  assert.notEqual(credentials.luis, credentials.elena);
  const stores = openStores(dataDir);
  const hashes = () => stores.db.prepare('SELECT username, password_hash FROM employees ORDER BY username').all().map((r) => ({ ...r }));
  const before = hashes();
  assert.deepEqual(runSetup(dataDir).created, []);
  assert.deepEqual(hashes(), before);
  assert.deepEqual(readCredentials(dataDir), credentials);
  assert.equal(stores.menuStore.readCurrent().length, 9);
  assert.equal(stores.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  stores.close();
  removeDataDir(dataDir);
});

test('SETUP does not re-add a dish the operator removed', () => {
  const dataDir = freshDataDir();
  runSetup(dataDir);
  let stores = openStores(dataDir);
  stores.db.exec('DELETE FROM menu_items');
  stores.close();
  runSetup(dataDir);
  stores = openStores(dataDir);
  assert.equal(stores.menuStore.readCurrent().length, 0);
  stores.close();
  removeDataDir(dataDir);
});

test('A1 menu API returns the supplied dishes, groups and order', async () => {
  const app = await startApp();
  try {
    const menu = await (await fetch(`${app.base}/api/menu`)).json();
    assert.deepEqual(menu.groups.map((g) => g.name), ['Meals', 'Sides', 'Drinks']);
    assert.deepEqual(menu.groups[0].items.map((i) => [i.name, i.price, i.available]), [
      ['Chicken casado', 4500, true], ['Vegetarian casado', 4000, true], ['Fish casado', 5000, false],
    ]);
    assert.equal(menu.open, true);
    assert.equal(menu.nextOpening, null);
    app.clock.t = costaRica(9, 22);
    const closed = await (await fetch(`${app.base}/api/menu`)).json();
    assert.equal(closed.open, false);
    assert.equal(closed.nextOpening, 'Tuesday, November 10, 10:00 AM');
  } finally {
    await app.stop();
  }
});
