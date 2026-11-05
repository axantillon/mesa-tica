import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { openingState } from './opening.js';
import { readMenu, readRestaurant, transaction } from './store.js';

export const tokenPattern = /^[a-f0-9]{64}$/;
const validToken = (value) => typeof value === 'string' && tokenPattern.test(value);
export const token = () => randomBytes(32).toString('hex');
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function orderSummary(row) {
  return {
    number: row.number,
    submittedAt: row.submitted_at,
    items: JSON.parse(row.items),
    total: row.total,
    status: row.status,
    reason: row.reason,
  };
}

function findAttempt(db, customer, attempt) {
  return db.prepare(`
    SELECT attempts.*, orders.*
    FROM attempts LEFT JOIN orders ON orders.number = attempts.order_number
    WHERE customer_hash = ? AND attempt = ?
  `).get(digest(customer), attempt);
}

function confirmation(order, differentSelection = false) {
  return {
    outcome: 'accepted',
    order: orderSummary(order),
    trackingPath: '/track/' + order.tracking_token,
    differentSelection,
  };
}

function validateSelection(selection, menu) {
  if (!Array.isArray(selection) || selection.length === 0) {
    return { issue: 'empty', corrections: [] };
  }
  const current = new Map(menu.map((dish) => [dish.code, dish]));
  const seen = new Set();
  const corrections = [];
  const items = [];
  let total = 0;
  for (const line of selection) {
    const { code, quantity, price } = line ?? {};
    if (typeof code !== 'string' || seen.has(code) ||
        !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(price) || price < 0) {
      return { issue: 'invalid_selection', corrections: [] };
    }
    seen.add(code);
    const dish = current.get(code);
    if (!dish?.available) {
      corrections.push({ code, issue: 'unavailable' });
      continue;
    }
    if (price !== dish.price) {
      corrections.push({ code, issue: 'price_changed', price: dish.price });
      continue;
    }
    const subtotal = dish.price * quantity;
    total += subtotal;
    if (!Number.isSafeInteger(total)) return { issue: 'total_too_large', corrections: [] };
    items.push({ code, name: dish.name, quantity, price: dish.price, subtotal });
  }
  return corrections.length ? { issue: 'review', corrections } : { items, total };
}

function checkIdentity({ customer, attempt }) {
  if (!validToken(customer) || !validToken(attempt)) throw new HttpError(400, 'invalid_attempt');
}

export function recoverOrder(db, identity) {
  checkIdentity(identity);
  const record = findAttempt(db, identity.customer, identity.attempt);
  return record?.order_number ? confirmation(record) : { outcome: 'unresolved' };
}

export function acceptOrder(db, body, now) {
  checkIdentity(body);
  const { customer, attempt, selection } = body;
  // Canonicalize the reviewed values without trusting any names or totals from the browser.
  const reviewed = Array.isArray(selection)
    ? selection.map((line) => [line?.code, line?.quantity, line?.price]).sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : selection ?? null;
  const fingerprint = digest(JSON.stringify(reviewed));
  return transaction(db, () => {
    const previous = findAttempt(db, customer, attempt);
    if (previous?.order_number) return confirmation(previous, previous.selection_hash !== fingerprint);
    if (previous) return JSON.parse(previous.rejection);

    const restaurant = readRestaurant(db);
    const proposal = validateSelection(selection, readMenu(db));
    const time = now();
    const opening = openingState(restaurant, time);
    const issue = opening.open ? proposal.issue : 'closed';
    if (issue) {
      const result = { outcome: 'rejected', issue, opening, corrections: proposal.corrections ?? [] };
      db.prepare(`
        INSERT INTO attempts (customer_hash, attempt, selection_hash, rejection) VALUES (?, ?, ?, ?)
      `).run(digest(customer), attempt, fingerprint, JSON.stringify(result));
      return result;
    }

    const order = db.prepare(`
      INSERT INTO orders (tracking_token, submitted_at, items, total, status)
      VALUES (?, ?, ?, ?, 'Received') RETURNING *
    `).get(token(), time.toISOString(), JSON.stringify(proposal.items), proposal.total);
    db.prepare(`
      INSERT INTO attempts (customer_hash, attempt, selection_hash, order_number) VALUES (?, ?, ?, ?)
    `).run(digest(customer), attempt, fingerprint, order.number);
    return confirmation(order);
  });
}

export function trackOrder(db, trackingToken) {
  const row = validToken(trackingToken) &&
    db.prepare('SELECT * FROM orders WHERE tracking_token = ?').get(trackingToken);
  if (!row) throw new HttpError(404, 'invalid_link');
  const order = orderSummary(row);
  const { timezone, pickupLocation, pickupInstructions, contact, contactLabel } = readRestaurant(db);
  return {
    order,
    timezone,
    guidance: order.status === 'Ready' ? { pickupLocation, pickupInstructions }
      : order.status === 'Cancelled' ? { contact, contactLabel } : {},
  };
}
