import { HttpError } from './http.js';
import { orderSummary } from './orders.js';
import { readRestaurant, transaction } from './store.js';

const next = {
  Received: 'Preparing',
  Preparing: 'Ready',
  Ready: 'Collected',
};
const statuses = ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'];
const filters = ['Active', ...statuses, 'All'];
const actionsFor = (status) => next[status] ? [next[status], 'Cancelled'] : [];

function readOrder(db, number) {
  const order = db.prepare('SELECT * FROM orders WHERE number = ?').get(number);
  if (!order) throw new HttpError(404, 'order_unavailable');
  return order;
}

function detail(db, row) {
  return {
    order: { ...orderSummary(row), revision: row.revision },
    history: db.prepare(`
      SELECT previous, status, employee_name AS employee, changed_at AS changedAt, reason
      FROM status_changes WHERE order_number = ? ORDER BY revision
    `).all(row.number),
    actions: actionsFor(row.status),
    timezone: readRestaurant(db).timezone,
  };
}

export function listQueue(db, filter) {
  if (!filters.includes(filter)) throw new HttpError(400, 'invalid_filter');
  const statuses = filter === 'Active' ? ['Received', 'Preparing', 'Ready'] : [filter];
  const clause = filter === 'All' ? '' : `WHERE status IN (${statuses.map(() => '?').join(', ')})`;
  const rows = db.prepare(`
    SELECT number, submitted_at, items, total, status, reason FROM orders ${clause}
    ORDER BY submitted_at, number
  `).all(...(filter === 'All' ? [] : statuses));
  return {
    orders: rows.map(orderSummary),
    timezone: readRestaurant(db).timezone,
  };
}

export function staffDetail(db, number) {
  return detail(db, readOrder(db, number));
}

export function changeStatus(db, number, { revision, target, reason, confirmed }, authorize, now) {
  return transaction(db, () => {
    const employee = authorize();
    const current = readOrder(db, number);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new HttpError(400, 'invalid_revision');
    if (current.revision !== revision) return { outcome: 'conflict', ...detail(db, current) };
    if (!actionsFor(current.status).includes(target)) throw new HttpError(422, 'invalid_transition');

    const cancelling = target === 'Cancelled';
    if (cancelling && (typeof reason !== 'string' || !reason.trim() || reason.length > 500)) {
      throw new HttpError(422, 'invalid_reason');
    }
    if (cancelling && confirmed !== true) throw new HttpError(422, 'confirm_cancellation');

    const cancellationReason = cancelling ? reason : null;
    const updated = db.prepare(`
      UPDATE orders SET status = ?, revision = revision + 1, reason = ?
      WHERE number = ? AND revision = ? RETURNING *
    `).get(target, cancellationReason, number, revision);
    db.prepare(`
      INSERT INTO status_changes (order_number, revision, previous, status, employee, employee_name, changed_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(number, updated.revision, current.status, target, employee.username, employee.name, now().toISOString(), cancellationReason);
    return { outcome: 'changed', ...detail(db, updated) };
  });
}
