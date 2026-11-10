import { formatCRC, formatLocalDateTime } from '../format.js';
import { isOpen } from '../policies/opening-policy.js';
import { canonicalSelection } from '../stores/order-store.js';
import { closedGuidance } from './menu-service.js';
import { acceptedItems, collectionGuidance } from './tracking-service.js';

/**
 * CheckoutService: acceptance orchestration and useful corrections. A selection is only accepted at
 * the reviewed prices, for known available dishes, during configured opening hours. Changed prices
 * are never authorized on the customer's behalf; they come back as a correction to review.
 */
export function createCheckoutService({ menuStore, restaurantStore, orderStore, clock }) {
  function validateSelection(selection, menu) {
    const byCode = new Map(menu.map((item) => [item.code, item]));
    const corrections = [];
    for (const line of selection) {
      const item = byCode.get(line.code);
      if (!item || !item.available) {
        corrections.push({
          code: line.code,
          kind: 'unavailable',
          name: item?.name ?? null,
          message: `${item?.name ?? 'This dish'} is no longer available. Remove it or choose another item.`,
        });
      } else if (item.price !== line.reviewedPrice) {
        corrections.push({
          code: line.code,
          kind: 'priceChanged',
          name: item.name,
          currentPrice: item.price,
          message: `${item.name} is now ${formatCRC(item.price)}. Review your updated total before placing the order.`,
        });
      }
    }
    return corrections;
  }

  /** Current conditions for this selection: a correction to show, or null when it can be accepted now. */
  function currentCorrection(selection, now) {
    const restaurant = restaurantStore.readRestaurant();
    const items = validateSelection(selection, menuStore.readCurrentMenu());
    const closed = isOpen(restaurant, now) ? null : { ...closedGuidance(restaurant, now), contact: restaurant.contact, contactLabel: restaurant.contactLabel };
    if (!closed && items.length === 0) return null;
    return {
      message: closed ? closed.message : 'Some items in your cart changed. Review your cart before placing the order.',
      closed,
      items,
    };
  }

  /** Accepted lines use current menu names and the (equal) reviewed prices; they never change afterwards. */
  function buildProposal(selection) {
    const byCode = new Map(menuStore.readCurrentMenu().map((item) => [item.code, item]));
    const lines = selection.map(({ code, quantity }) => {
      const item = byCode.get(code);
      return { code, name: item.name, unitPrice: item.price, quantity, subtotal: item.price * quantity };
    });
    return { lines, total: lines.reduce((sum, line) => sum + line.subtotal, 0) };
  }

  function buildConfirmation(order) {
    const restaurant = restaurantStore.readRestaurant();
    return {
      orderNumber: order.number,
      status: order.status,
      submittedLabel: formatLocalDateTime(new Date(order.submittedAt), restaurant.timezone),
      items: acceptedItems(order),
      total: order.total,
      trackingPath: `/track/${order.privateToken}`,
      guidance: collectionGuidance(order, restaurant),
      pickupInstructions: ['Cancelled', 'Collected'].includes(order.status) ? null : restaurant.pickupInstructions,
    };
  }

  function present(outcome, selection) {
    const differentSelection = Boolean(selection) && canonicalSelection(selection) !== outcome.selection;
    if (outcome.outcome === 'accepted') {
      return { outcome: 'accepted', created: Boolean(outcome.created), differentSelection, confirmation: buildConfirmation(outcome.order) };
    }
    if (outcome.outcome === 'closed') {
      return { outcome: 'rejected', differentSelection, correction: outcome.correction };
    }
    return { outcome: 'unresolved' };
  }

  return {
    validateSelection,
    buildConfirmation,

    /**
     * A3/A4 submission. An attempt that already has a recorded decision returns it before any new-order
     * checks (so an accepted retry succeeds even after closing or a menu change, and a closed attempt
     * stays closed). Otherwise early checks produce corrections, and the decisive acceptOnce boundary
     * rechecks the same conditions under the write lock before recording one order.
     */
    accept(context, attempt, selection) {
      const now = clock.now();
      const prior = orderStore.readAttemptOutcome(context, attempt);
      if (prior.outcome !== 'absent') return present(prior, selection);

      const correction = currentCorrection(selection, now);
      const outcome = correction
        ? orderStore.resolveRejectedAttempt(context, attempt, selection, correction, now)
        : orderStore.acceptOnce(
            context,
            attempt,
            selection,
            () => {
              const recheck = currentCorrection(selection, now);
              return recheck ? { correction: recheck } : { proposal: buildProposal(selection) };
            },
            now,
          );
      return present(outcome, selection);
    },

    /** A4 recovery: reads the durable attempt outcome only; never creates or rejects anything. */
    recover(context, attempt) {
      return present(orderStore.readAttemptOutcome(context, attempt), null);
    },
  };
}
