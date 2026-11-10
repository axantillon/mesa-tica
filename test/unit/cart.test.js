import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addItem,
  applyCorrection,
  calculateTotal,
  changeQuantity,
  clearPurchased,
  parseQuantity,
  reconcileWithMenu,
  removeItem,
  toSelection,
} from '../../public/assets/cart.js';

const menu = {
  M1: { code: 'M1', name: 'Chicken casado', price: 4500, available: true },
  M3: { code: 'M3', name: 'Fish casado', price: 5000, available: false },
  S2: { code: 'S2', name: 'Cheese empanada', price: 1400, available: true },
  D2: { code: 'D2', name: 'Iced tea', price: 1000, available: true },
};

function workedCart() {
  let items = [];
  for (const code of ['M1', 'S2', 'D2', 'D2']) items = addItem(items, menu[code]).items;
  return items;
}

test('adding the same dish increases one row', () => {
  const items = workedCart();
  assert.equal(items.length, 3);
  assert.equal(items.find((item) => item.code === 'D2').quantity, 2);
});

test('worked menu totals match exactly', () => {
  const items = workedCart();
  assert.equal(calculateTotal(items).total, 7900);
  assert.equal(calculateTotal(changeQuantity(items, 'D2', 3)).total, 8900);
  assert.equal(calculateTotal(removeItem(items, 'S2')).total, 6500);
  const repriced = applyCorrection(items, {
    items: [{ code: 'M1', kind: 'priceChanged', name: 'Chicken casado', currentPrice: 4600, message: 'Chicken casado is now ₡4,600.' }],
  });
  assert.equal(calculateTotal(repriced).total, 8000);
  assert.equal(repriced.find((item) => item.code === 'M1').notice, 'Chicken casado is now ₡4,600.');
});

test('unavailable dishes cannot be added', () => {
  const result = addItem([], menu.M3);
  assert.equal(result.added, false);
  assert.deepEqual(result.items, []);
  assert.match(result.message, /Fish casado is unavailable/);
});

test('quantities must be positive whole numbers and are never coerced', () => {
  for (const text of ['0', '-1', '1.5', '2.0', 'abc', '', ' ', '1e2', '+3', 'two']) {
    assert.deepEqual(parseQuantity(text), { ok: false, message: 'Enter a whole number greater than zero.' }, text);
  }
  assert.equal(parseQuantity('100').ok, false);
  assert.deepEqual(parseQuantity(' 3 '), { ok: true, value: 3 });
  assert.deepEqual(parseQuantity('99'), { ok: true, value: 99 });
});

test('removing the final item empties the cart', () => {
  const items = removeItem(addItem([], menu.M1).items, 'M1');
  assert.deepEqual(items, []);
  assert.equal(calculateTotal(items).total, 0);
});

test('reconciling with the current menu flags unavailable dishes and shows new prices', () => {
  const items = workedCart();
  const current = [
    { ...menu.M1, price: 4600 },
    { ...menu.S2, available: false },
    menu.D2,
  ];
  const reconciled = reconcileWithMenu(items, current);
  assert.equal(reconciled.find((item) => item.code === 'M1').reviewedPrice, 4600);
  assert.match(reconciled.find((item) => item.code === 'M1').notice, /now ₡4,600/);
  assert.equal(reconciled.find((item) => item.code === 'S2').unavailable, true);
  assert.equal(reconciled.find((item) => item.code === 'S2').quantity, 1, 'unavailable items stay identified with their quantity');
});

test('clearing the purchased selection keeps items added afterwards', () => {
  const purchased = toSelection(workedCart());
  const later = addItem(workedCart(), menu.M1).items;
  assert.deepEqual(clearPurchased(later, purchased).map(({ code, quantity }) => ({ code, quantity })), [{ code: 'M1', quantity: 1 }]);
  assert.deepEqual(clearPurchased(workedCart(), purchased), []);
});
