import { formatLocalDateTime } from '../format.js';
import { allowedActions, validateChange } from '../policies/order-lifecycle.js';
import { cancellationReason } from './tracking-service.js';

/** OrderService: staff queue, accepted detail and status-change orchestration. */
export function createOrderService({ orderStore, restaurantStore, clock }) {
  const timeZone = () => restaurantStore.readRestaurant().timezone;

  function detail(order) {
    const zone = timeZone();
    return {
      number: order.number,
      submittedLabel: formatLocalDateTime(new Date(order.submittedAt), zone),
      status: order.status,
      revision: order.revision,
      total: order.total,
      items: order.items.map(({ name, quantity, unitPrice, subtotal }) => ({ name, quantity, unitPrice, subtotal })),
      history: order.history.map((change) => ({
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
        employeeName: change.employeeName,
        timeLabel: formatLocalDateTime(new Date(change.changedAt), zone),
        reason: change.reason,
      })),
      cancellationReason: cancellationReason(order),
      allowedActions: allowedActions(order.status),
      timezone: zone,
    };
  }

  return {
    listQueue(filter) {
      const zone = timeZone();
      return {
        filter,
        timezone: zone,
        orders: orderStore.listOrders(filter).map((order) => ({
          ...order,
          submittedLabel: formatLocalDateTime(new Date(order.submittedAt), zone),
        })),
      };
    },

    getDetail(number) {
      const order = orderStore.readOrder(number);
      return order ? detail(order) : null;
    },

    /**
     * B3. Early checks give distinct outcomes (missing order, stale revision, invalid action/reason);
     * changeIfCurrent then repeats the revision and from-status check at the write boundary, so an
     * earlier read is never the only guarantee. Outcomes: not_found, conflict, invalid or changed.
     */
    changeStatus(number, revision, target, reason, employee) {
      const current = orderStore.readOrder(number);
      if (!current) return { result: 'not_found' };
      if (current.revision !== revision) return { result: 'conflict', order: detail(current) };
      const correction = validateChange(current.status, target, reason);
      if (correction) return { result: 'invalid', correction, order: detail(current) };

      const savedReason = target === 'Cancelled' ? reason.trim() : null;
      const outcome = orderStore.changeIfCurrent(number, revision, current.status, target, savedReason, employee.id, clock.now());
      if (outcome.result === 'not_found') return outcome;
      return { result: outcome.result, order: detail(outcome.order) };
    },
  };
}
