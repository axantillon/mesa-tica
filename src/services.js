// Application services: orchestration between controllers, policies and stores.

import { createHash, randomBytes } from 'node:crypto';
import { allowedActions, dateTimeLabel, hoursLabel, isOpen, nextOpening, timeLabel, validateChange } from './policies.js';
import { hashPassword, verifyPassword } from './store.js';

export const MAX_QUANTITY = 999;

const STATUS_MESSAGES = {
  Received: 'The restaurant has received your order. It is not ready for pickup yet.',
  Preparing: 'Your meal is being prepared. It is not ready for pickup yet.',
  Ready: 'Your order is ready for pickup.',
  Collected: 'This order has been collected.',
  Cancelled: 'This order was cancelled.',
};

function validateSelection(selection, menu) {
  if (!Array.isArray(selection) || selection.length === 0) return [{ type: 'empty' }];
  const corrections = [];
  const seen = new Set();
  for (const line of selection) {
    const itemId = line?.itemId;
    if (typeof itemId !== 'string' || seen.has(itemId)) {
      corrections.push({ type: 'invalid_selection', itemId: String(itemId) });
      continue;
    }
    seen.add(itemId);
    const item = menu.get(itemId);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      corrections.push({ type: 'invalid_quantity', itemId });
    } else if (!item?.available) {
      corrections.push({ type: 'unavailable', itemId, name: item?.name ?? null });
    } else if (item.price !== line.reviewedPrice) {
      corrections.push({ type: 'price_changed', itemId, name: item.name, price: item.price });
    }
  }
  return corrections;
}

/** Canonical stored form, so a retry can be compared with the selection it was bound to. */
const canonicalSelection = (selection) => JSON.stringify(
  (Array.isArray(selection) ? selection : [])
    .map((line) => ({ itemId: line?.itemId, quantity: line?.quantity, reviewedPrice: line?.reviewedPrice }))
    .sort((a, b) => String(a.itemId).localeCompare(String(b.itemId))),
);

export const SESSION_MS = 12 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 5;
const MAX_FAILURES_PER_IP = 20;
const MAX_TRACKED_FAILURES = 10_000;
const MAX_CONCURRENT_PASSWORD_CHECKS = 3; // below the libuv pool size, so sign-in floods cannot starve other work
const UNKNOWN_ACCOUNT_HASH = hashPassword(randomBytes(16).toString('hex'));

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createServices(stores, now) {
  const { restaurantStore, menuStore, orderStore, identityStore, transaction } = stores;

  const publicRestaurant = (r) => ({
    name: r.name,
    descriptor: r.descriptor,
    hours: hoursLabel(r),
    pickupLocation: r.pickupLocation,
    pickupInstructions: r.pickupInstructions,
    contact: r.contact,
    contactLabel: r.contactLabel,
    customerNote: r.customerNote,
  });

  const opening = (r, t) => {
    const open = isOpen(r, t);
    return { open, nextOpening: open ? null : nextOpening(r, t) };
  };

  const menuService = {
    getMenu() {
      const t = now();
      const restaurant = restaurantStore.read();
      const groups = [];
      for (const item of menuStore.readCurrent()) {
        let group = groups.find((g) => g.name === item.group);
        if (!group) groups.push(group = { name: item.group, items: [] });
        group.items.push(item);
      }
      return { restaurant: publicRestaurant(restaurant), ...opening(restaurant, t), groups, checked: timeLabel(t, restaurant.timezone) };
    },
  };

  function collectionGuidance(order, restaurant) {
    const guidance = { message: STATUS_MESSAGES[order.status] };
    if (order.status === 'Ready') {
      guidance.pickup = {
        instructions: restaurant.pickupInstructions,
        location: restaurant.pickupLocation,
        payment: 'Pay at collection.',
      };
    }
    if (order.status === 'Cancelled') {
      guidance.cancellation = {
        reason: order.cancellationReason,
        contact: restaurant.contact,
        contactLabel: restaurant.contactLabel,
      };
    }
    return guidance;
  }

  function buildConfirmation(order, restaurant, extra = {}) {
    return {
      outcome: 'accepted',
      number: order.number,
      submitted: dateTimeLabel(order.submittedAt, restaurant.timezone),
      status: order.status,
      items: order.items,
      total: order.total,
      trackingPath: `/track/${order.token}`,
      guidance: collectionGuidance(order, restaurant),
      paymentInstructions: ['Cancelled', 'Collected'].includes(order.status) ? null : restaurant.pickupInstructions,
      ...extra,
    };
  }

  const presentRejection = (rejection, restaurant, t) => ({
    outcome: 'rejected',
    ...rejection,
    ...opening(restaurant, t),
    contact: restaurant.contact,
    contactLabel: restaurant.contactLabel,
  });

  /** The already-decided outcome of an attempt, in the shape of a fresh result. */
  function replayAttempt(prior, selection, restaurant, t) {
    if (prior.rejection) return presentRejection(JSON.parse(prior.rejection), restaurant, t);
    const extra = selection !== undefined && canonicalSelection(selection) !== prior.selection ? { selectionMismatch: true } : {};
    return buildConfirmation(orderStore.readOrder(prior.order_number), restaurant, extra);
  }

  const checkoutService = {
    /**
     * Realizes findAccepted, resolveRejectedAttempt and acceptOnce as one indivisible transaction:
     * a prior outcome is returned before any new check, otherwise current menu and hours are
     * evaluated and exactly one order or one closed attempt is recorded.
     */
    accept(context, attempt, selection) {
      return transaction(() => {
        const t = now();
        const restaurant = restaurantStore.read();
        const prior = orderStore.findAttempt(context, attempt);
        if (prior) return replayAttempt(prior, selection, restaurant, t);

        const menuItems = menuStore.readCurrent();
        const menu = new Map(menuItems.map((item) => [item.id, item]));
        const corrections = validateSelection(selection, menu);
        const closed = !isOpen(restaurant, t);
        const canonical = canonicalSelection(selection);
        if (closed || corrections.length) {
          const rejection = { closed, corrections };
          orderStore.closeAttempt(context, attempt, canonical, rejection, t);
          return presentRejection(rejection, restaurant, t);
        }

        const lines = selection.map(({ itemId, quantity }) => {
          const { name, price } = menu.get(itemId);
          return { itemId, name, price, quantity, subtotal: price * quantity };
        });
        const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
        const number = orderStore.recordAccepted(context, attempt, canonical, lines, total, t);
        return buildConfirmation(orderStore.readOrder(number), restaurant);
      });
    },

    recover(context, attempt) {
      const prior = orderStore.findAttempt(context, attempt);
      if (!prior) return { outcome: 'unresolved' };
      return replayAttempt(prior, undefined, restaurantStore.read(), now());
    },
  };

  const trackingService = {
    /** The public projection of one order: never staff identities, history or internal fields. */
    getSnapshot(token) {
      const order = orderStore.findByPrivateLink(token);
      if (!order) return null;
      const restaurant = restaurantStore.read();
      return {
        number: order.number,
        submitted: dateTimeLabel(order.submittedAt, restaurant.timezone),
        status: order.status,
        items: order.items,
        total: order.total,
        guidance: collectionGuidance(order, restaurant),
        checked: timeLabel(now(), restaurant.timezone),
      };
    },
  };

  function presentDetail(order, restaurant) {
    return {
      number: order.number,
      submitted: dateTimeLabel(order.submittedAt, restaurant.timezone),
      status: order.status,
      revision: order.revision,
      items: order.items,
      total: order.total,
      cancellationReason: order.cancellationReason,
      history: orderStore.readHistory(order.number).map((change) => ({
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
        employee: change.employee,
        time: dateTimeLabel(change.at, restaurant.timezone),
        reason: change.reason,
      })),
      allowedActions: allowedActions(order.status),
      checked: timeLabel(now(), restaurant.timezone),
    };
  }

  const orderService = {
    listQueue(filter) {
      const { timezone } = restaurantStore.read();
      return {
        orders: orderStore.listOrders(filter).map(({ submittedAt, ...row }) => ({ ...row, submitted: dateTimeLabel(submittedAt, timezone) })),
        checked: timeLabel(now(), timezone),
      };
    },

    getDetail(number) {
      const order = orderStore.readOrder(number);
      return order ? presentDetail(order, restaurantStore.read()) : null;
    },

    /** Realizes the design's changeIfCurrent boundary: revision and transition are checked where the write happens. */
    changeStatus(number, revision, target, reason, employee) {
      return transaction(() => {
        const restaurant = restaurantStore.read();
        const order = orderStore.readOrder(number);
        if (!order) return { outcome: 'unavailable' };
        if (order.revision !== revision) return { outcome: 'conflict', order: presentDetail(order, restaurant) };
        const problem = validateChange(order.status, target, reason);
        if (problem) return { outcome: 'invalid', message: problem, order: presentDetail(order, restaurant) };
        orderStore.changeIfCurrent(number, revision, target, reason, employee.id, now());
        return { outcome: 'changed', order: presentDetail(orderStore.readOrder(number), restaurant) };
      });
    },
  };

  const failedSignIns = new Map(); // key -> { count, resetAt }
  let passwordChecks = 0;

  const signInKeys = (ip, username) => [
    { key: `ip:${ip}`, limit: MAX_FAILURES_PER_IP },
    { key: `account:${ip}|${username}`, limit: MAX_FAILURES_PER_ACCOUNT },
  ];

  const isLimited = (keys, t) => keys.some(({ key, limit }) => {
    const entry = failedSignIns.get(key);
    return entry && entry.resetAt > t && entry.count >= limit;
  });

  function recordFailure(keys, t) {
    if (failedSignIns.size > MAX_TRACKED_FAILURES) {
      for (const [key, entry] of failedSignIns) if (entry.resetAt <= t) failedSignIns.delete(key);
    }
    for (const { key } of keys) {
      const entry = failedSignIns.get(key);
      if (entry && entry.resetAt > t) entry.count += 1;
      else failedSignIns.set(key, { count: 1, resetAt: t + FAILURE_WINDOW_MS });
    }
  }

  const accessService = {
    // ponytail: in-memory limiter, per process and cleared on restart; move to the database if the app runs as several processes.
    async signIn(username, password, ip) {
      const keys = signInKeys(ip, username);
      if (isLimited(keys, now()) || passwordChecks >= MAX_CONCURRENT_PASSWORD_CHECKS) return { outcome: 'limited' };
      passwordChecks += 1;
      try {
        const employee = identityStore.findByUsername(username);
        // An unknown account still costs a full password check, so timing does not reveal it.
        const matches = await verifyPassword(password, employee?.password_hash ?? UNKNOWN_ACCOUNT_HASH);
        if (!matches || employee?.authorized !== 1) {
          recordFailure(keys, now());
          return { outcome: 'failed' };
        }
        const token = randomBytes(32).toString('base64url');
        identityStore.createSession(hashToken(token), employee.id, now() + SESSION_MS, now());
        return { outcome: 'signed_in', token, displayName: employee.display_name };
      } finally {
        passwordChecks -= 1;
      }
    },

    requireStaff: (token) => (token ? identityStore.resolveAccess(hashToken(token), now()) ?? null : null),

    signOut(token) {
      if (token) identityStore.revokeAccess(hashToken(token));
    },
  };

  return { menuService, checkoutService, trackingService, orderService, accessService };
}
