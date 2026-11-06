// C · TrackingController: one order by its private token. Server-side only.
export class TrackingController {
  constructor(orderStore, restaurantStore) {
    this.orderStore = orderStore;
    this.restaurantStore = restaurantStore;
  }

  // The token is the only key. No staff names; instructions only when Ready; reason and contact only when Cancelled.
  getTracking(token) {
    const order = typeof token === 'string' && token ? this.orderStore.findByToken(token) : undefined;
    if (!order) return { status: 404, body: { reason: 'not_found' } };
    const { collectionInstructions, contact } = this.restaurantStore.readRestaurant();
    const body = {
      number: order.number, status: order.status, submittedAt: order.submittedAt, total: order.total, lines: order.lines,
    };
    if (order.status === 'Ready') body.collectionInstructions = collectionInstructions;
    if (order.status === 'Cancelled') Object.assign(body, { cancellationReason: order.cancellationReason, contact });
    return { status: 200, body };
  }
}
