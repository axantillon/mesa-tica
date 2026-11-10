import crypto from 'node:crypto';
import { ORDER_STATUSES, transaction } from '../db.js';

/** OrderFilter values: Active is the default working set, each status filter shows itself, All shows everything. */
export const ORDER_FILTERS = {
  Active: ['Received', 'Preparing', 'Ready'],
  ...Object.fromEntries(ORDER_STATUSES.map((status) => [status, [status]])),
  All: ORDER_STATUSES,
};

const FIRST_ORDER_NUMBER = 101;

/** Stable representation of a reviewed selection, used to tell whether a retry carried the same choices. */
export function canonicalSelection(selection) {
  const lines = selection
    .map(({ code, quantity, reviewedPrice }) => ({ code, quantity, reviewedPrice }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return JSON.stringify(lines);
}

/**
 * OrderStore: accepted orders, their immutable lines, staff status history and the durable outcome of
 * every decided submission attempt. Attempts are keyed by (customer context, attempt reference), so a
 * lookup can only ever return the attempt created by that same browser context.
 */
export function createOrderStore(db) {
  const statements = {
    attempt: db.prepare(
      'SELECT selection, outcome, order_number, correction FROM submission_attempts WHERE customer_context = ? AND attempt_id = ?',
    ),
    insertAttempt: db.prepare(
      `INSERT INTO submission_attempts (customer_context, attempt_id, selection, outcome, order_number, correction, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    nextNumber: db.prepare(`SELECT COALESCE(MAX(number), ${FIRST_ORDER_NUMBER - 1}) + 1 AS number FROM orders`),
    insertOrder: db.prepare(
      'INSERT INTO orders (number, private_token, submitted_at, status, revision, total) VALUES (?, ?, ?, ?, 1, ?)',
    ),
    insertLine: db.prepare(
      `INSERT INTO order_items (order_number, line, item_code, name, unit_price, quantity, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    order: db.prepare('SELECT number, private_token, submitted_at, status, revision, total FROM orders WHERE number = ?'),
    orderByToken: db.prepare('SELECT number FROM orders WHERE private_token = ?'),
    lines: db.prepare(
      'SELECT item_code, name, unit_price, quantity, subtotal FROM order_items WHERE order_number = ? ORDER BY line',
    ),
    history: db.prepare(
      `SELECT c.from_status, c.to_status, c.changed_at, c.reason, e.display_name
       FROM status_changes c JOIN employees e ON e.id = c.employee_id
       WHERE c.order_number = ? ORDER BY c.id`,
    ),
    conditionalChange: db.prepare(
      'UPDATE orders SET status = ?, revision = revision + 1 WHERE number = ? AND revision = ? AND status = ?',
    ),
    insertChange: db.prepare(
      `INSERT INTO status_changes (order_number, from_status, to_status, employee_id, changed_at, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
  };

  function insertClosedAttempt(context, attempt, selection, correction, now) {
    statements.insertAttempt.run(
      context,
      attempt,
      canonicalSelection(selection),
      'closed',
      null,
      JSON.stringify(correction),
      now.getTime(),
    );
    return { outcome: 'closed', correction, selection: canonicalSelection(selection) };
  }

  const store = {
    /** 24 random bytes = 192 bits of entropy, encoded as 32 URL-safe characters. */
    issuePrivateLink() {
      return crypto.randomBytes(24).toString('base64url');
    },

    /**
     * Durable attempt outcome: accepted (with its order), closed (with the original correction) or absent.
     * Absent is not proof of rejection; callers must keep that attempt uncertain. This also realizes the
     * logical findAccepted operation through its accepted branch.
     */
    readAttemptOutcome(context, attempt) {
      const row = statements.attempt.get(context, attempt);
      if (!row) return { outcome: 'absent' };
      if (row.outcome === 'accepted') {
        return { outcome: 'accepted', order: store.readOrder(row.order_number), selection: row.selection };
      }
      return { outcome: 'closed', correction: JSON.parse(row.correction), selection: row.selection };
    },

    /**
     * The decisive acceptance boundary. Inside one write transaction it returns an earlier decision for the
     * attempt if one exists; otherwise it runs `recheck` against current menu/hours and either records exactly
     * one Received order (lines, total, private link and the accepted attempt) or records the attempt as closed.
     */
    acceptOnce(context, attempt, selection, recheck, now) {
      return transaction(db, () => {
        const prior = store.readAttemptOutcome(context, attempt);
        if (prior.outcome !== 'absent') return prior;

        const decision = recheck();
        if (decision.correction) return insertClosedAttempt(context, attempt, selection, decision.correction, now);

        const { lines, total } = decision.proposal;
        const { number } = statements.nextNumber.get();
        statements.insertOrder.run(number, store.issuePrivateLink(), now.getTime(), 'Received', total);
        lines.forEach((line, index) => {
          statements.insertLine.run(number, index + 1, line.code, line.name, line.unitPrice, line.quantity, line.subtotal);
        });
        statements.insertAttempt.run(
          context,
          attempt,
          canonicalSelection(selection),
          'accepted',
          number,
          null,
          now.getTime(),
        );
        return { outcome: 'accepted', order: store.readOrder(number), selection: canonicalSelection(selection), created: true };
      });
    },

    /**
     * Closes a rejected attempt with its correction, but only after checking (under the write lock) that no
     * competing request already accepted or closed it; in that case the earlier decision is returned instead.
     */
    resolveRejectedAttempt(context, attempt, selection, correction, now) {
      return transaction(db, () => {
        const prior = store.readAttemptOutcome(context, attempt);
        if (prior.outcome !== 'absent') return prior;
        return insertClosedAttempt(context, attempt, selection, correction, now);
      });
    },

    /** Orders matching the filter, oldest submission first with order number as the stable tie-break. */
    listOrders(filter) {
      const statuses = ORDER_FILTERS[filter];
      const placeholders = statuses.map(() => '?').join(', ');
      const orders = db
        .prepare(
          `SELECT number, submitted_at, status, revision, total FROM orders
           WHERE status IN (${placeholders}) ORDER BY submitted_at, number`,
        )
        .all(...statuses);
      const linesByOrder = new Map(orders.map((order) => [order.number, []]));
      if (orders.length > 0) {
        db.prepare(
          `SELECT order_number, name, quantity FROM order_items
           WHERE order_number IN (SELECT number FROM orders WHERE status IN (${placeholders}))
           ORDER BY order_number, line`,
        )
          .all(...statuses)
          .forEach((line) => linesByOrder.get(line.order_number)?.push({ name: line.name, quantity: line.quantity }));
      }
      return orders.map((order) => ({
        number: order.number,
        submittedAt: order.submitted_at,
        status: order.status,
        revision: order.revision,
        total: order.total,
        items: linesByOrder.get(order.number),
      }));
    },

    readOrder(number) {
      const order = statements.order.get(number);
      if (!order) return null;
      return {
        number: order.number,
        privateToken: order.private_token,
        submittedAt: order.submitted_at,
        status: order.status,
        revision: order.revision,
        total: order.total,
        items: statements.lines.all(number).map((line) => ({
          code: line.item_code,
          name: line.name,
          unitPrice: line.unit_price,
          quantity: line.quantity,
          subtotal: line.subtotal,
        })),
        history: statements.history.all(number).map((change) => ({
          fromStatus: change.from_status,
          toStatus: change.to_status,
          employeeName: change.display_name,
          changedAt: change.changed_at,
          reason: change.reason,
        })),
      };
    },

    findByPrivateLink(privateToken) {
      const row = statements.orderByToken.get(privateToken);
      return row ? store.readOrder(row.number) : null;
    },

    /**
     * Final status-change boundary. The conditional UPDATE only matches if the order still has the revision
     * the employee observed and the status the transition was validated from; the history row is written in
     * the same transaction, so status and employee/time history are saved together or not at all.
     */
    changeIfCurrent(number, revision, fromStatus, target, reason, employeeId, now) {
      return transaction(db, () => {
        const updated = statements.conditionalChange.run(target, number, revision, fromStatus);
        if (updated.changes !== 1) {
          const current = store.readOrder(number);
          return current ? { result: 'conflict', order: current } : { result: 'not_found' };
        }
        statements.insertChange.run(number, fromStatus, target, employeeId, now.getTime(), reason);
        return { result: 'changed', order: store.readOrder(number) };
      });
    },
  };
  return store;
}
