import { formatLocalDateTime } from '../format.js';

const PAYMENT_STATEMENT = 'Pay at collection. There is no online payment.';

export function cancellationReason(order) {
  return order.history.findLast((change) => change.toStatus === 'Cancelled')?.reason ?? null;
}

/** Status meaning and next step for the customer. Only Ready invites collection. */
export function collectionGuidance(order, restaurant) {
  switch (order.status) {
    case 'Received':
      return {
        readyForPickup: false,
        message: 'The restaurant has received your order. It is not ready for pickup yet.',
        paymentStatement: PAYMENT_STATEMENT,
      };
    case 'Preparing':
      return {
        readyForPickup: false,
        message: 'Your meal is being prepared. It is not ready for pickup yet.',
        paymentStatement: PAYMENT_STATEMENT,
      };
    case 'Ready':
      return {
        readyForPickup: true,
        message: 'Your order is ready for pickup.',
        orderNumber: order.number,
        pickupLocation: restaurant.pickupLocation,
        pickupInstructions: restaurant.pickupInstructions,
        paymentStatement: PAYMENT_STATEMENT,
      };
    case 'Collected':
      return {
        readyForPickup: false,
        message: 'This order has been collected. No further pickup action is needed.',
      };
    case 'Cancelled':
      return {
        readyForPickup: false,
        message: 'This order was cancelled. It will not be prepared or collected.',
        reason: cancellationReason(order),
        contact: restaurant.contact,
        contactLabel: restaurant.contactLabel,
      };
    default:
      throw new Error(`Unknown order status ${order.status}`);
  }
}

/** Customer-safe order lines; accepted names and prices come from the order, never today's menu. */
export function acceptedItems(order) {
  return order.items.map(({ name, quantity, unitPrice, subtotal }) => ({ name, quantity, unitPrice, subtotal }));
}

/**
 * TrackingService: private-link reads. The snapshot deliberately omits staff names, history, revision and
 * any account details; possession of the link grants read access to this one order only.
 */
export function createTrackingService({ orderStore, restaurantStore }) {
  return {
    getSnapshot(privateToken) {
      const order = orderStore.findByPrivateLink(privateToken);
      if (!order) return null;
      const restaurant = restaurantStore.readRestaurant();
      return {
        restaurantName: restaurant.name,
        timezone: restaurant.timezone,
        orderNumber: order.number,
        submittedLabel: formatLocalDateTime(new Date(order.submittedAt), restaurant.timezone),
        status: order.status,
        items: acceptedItems(order),
        total: order.total,
        guidance: collectionGuidance(order, restaurant),
        changesNote: 'Orders cannot be changed or cancelled online. Restaurant staff handle any changes.',
      };
    },
  };
}
