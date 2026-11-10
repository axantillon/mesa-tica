/**
 * Cart: the customer's editable selection. Pure functions over an array of
 * { code, quantity, reviewedName, reviewedPrice, unavailable?, notice? } so they can be unit tested.
 * The cart is a selection, not a reservation: the server decides prices and availability at acceptance.
 */
import { formatCRC } from './common.js';

export const MAX_QUANTITY = 99;
export const QUANTITY_MESSAGE = 'Enter a whole number greater than zero.';

/** Accepts only positive whole numbers typed as digits; never coerces "1.5", "-1", "0" or "two". */
export function parseQuantity(text) {
  const trimmed = String(text).trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) return { ok: false, message: QUANTITY_MESSAGE };
  const value = Number(trimmed);
  if (value > MAX_QUANTITY) return { ok: false, message: `Enter a whole number from 1 to ${MAX_QUANTITY}.` };
  return { ok: true, value };
}

export function addItem(items, menuItem) {
  if (!menuItem.available) {
    return { items, added: false, message: `${menuItem.name} is unavailable and can't be added.` };
  }
  const existing = items.find((item) => item.code === menuItem.code);
  if (!existing) {
    return {
      items: [...items, { code: menuItem.code, quantity: 1, reviewedName: menuItem.name, reviewedPrice: menuItem.price }],
      added: true,
    };
  }
  if (existing.quantity >= MAX_QUANTITY) {
    return { items, added: false, message: `You can order up to ${MAX_QUANTITY} of one dish.` };
  }
  return { items: items.map((item) => (item.code === menuItem.code ? { ...item, quantity: item.quantity + 1 } : item)), added: true };
}

export function changeQuantity(items, code, quantity) {
  return items.map((item) => (item.code === code ? { ...item, quantity } : item));
}

export function removeItem(items, code) {
  return items.filter((item) => item.code !== code);
}

/** Exact integer colones: subtotal = price × quantity, total = sum of subtotals, no added fees. */
export function calculateTotal(items) {
  const lines = items.map((item) => ({ ...item, subtotal: item.reviewedPrice * item.quantity }));
  return { lines, total: lines.reduce((sum, line) => sum + line.subtotal, 0), count: items.reduce((sum, item) => sum + item.quantity, 0) };
}

export function toSelection(items) {
  return items.map(({ code, quantity, reviewedPrice }) => ({ code, quantity, reviewedPrice }));
}

/** Applies a server correction: repriced dishes show the new price for review; unavailable dishes stay identified. */
export function applyCorrection(items, correction) {
  const byCode = new Map((correction.items ?? []).map((entry) => [entry.code, entry]));
  return items.map((item) => {
    const entry = byCode.get(item.code);
    if (!entry) return item;
    if (entry.kind === 'priceChanged') {
      return { ...item, reviewedName: entry.name, reviewedPrice: entry.currentPrice, unavailable: false, notice: entry.message };
    }
    return { ...item, unavailable: true, notice: `${item.reviewedName} is no longer available. Remove it or choose another item.` };
  });
}

/** Compares a stored cart with the current menu when the page opens or the menu is reloaded. */
export function reconcileWithMenu(items, menuItems) {
  const byCode = new Map(menuItems.map((item) => [item.code, item]));
  return items.map((item) => {
    const current = byCode.get(item.code);
    if (!current || !current.available) {
      return { ...item, unavailable: true, notice: `${item.reviewedName} is no longer available. Remove it or choose another item.` };
    }
    if (current.price !== item.reviewedPrice) {
      return {
        ...item,
        reviewedName: current.name,
        reviewedPrice: current.price,
        unavailable: false,
        notice: `${current.name} is now ${formatCRC(current.price)}. Review your updated total before placing the order.`,
      };
    }
    if (item.unavailable) return { ...item, unavailable: false, notice: undefined };
    return item;
  });
}

/** After a known acceptance, removes the purchased quantities (items added afterwards are kept). */
export function clearPurchased(items, selection) {
  const purchased = new Map(selection.map((line) => [line.code, line.quantity]));
  return items
    .map((item) => ({ ...item, quantity: item.quantity - (purchased.get(item.code) ?? 0) }))
    .filter((item) => item.quantity > 0);
}

export function clearNotices(items) {
  return items.map(({ notice, ...item }) => item);
}
