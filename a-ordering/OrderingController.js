// A · OrderingController: menu, opening-hours rule, place order. Server-side only.
export const MAX_QUANTITY = 99;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Wall-clock date and time of an instant in a time zone.
function localTime(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    weekday: WEEKDAYS.indexOf(parts.weekday), minutes: +parts.hour * 60 + +parts.minute,
  };
}

// The UTC instant of a wall-clock time in a time zone (day may overflow; Date.UTC normalises it).
function zonedTime(year, month, day, hhmm, timeZone) {
  const wall = Date.UTC(year, month - 1, day, 0, toMinutes(hhmm));
  const offset = (t) => {
    const l = localTime(new Date(t), timeZone);
    return Date.UTC(l.year, l.month - 1, l.day, 0, l.minutes) - Math.floor(t / 60000) * 60000;
  };
  let t = wall - offset(wall);
  t = wall - offset(t); // second pass in case the offset differs at the result (daylight saving)
  return new Date(t);
}

const confirmation = (order) => ({
  number: order.number,
  status: order.status,
  submittedAt: order.submittedAt,
  total: order.total,
  lines: order.lines,
  trackingLink: `/track/${order.trackingToken}`,
});

export class OrderingController {
  constructor(restaurantStore, orderStore, now) {
    this.restaurantStore = restaurantStore;
    this.orderStore = orderStore;
    this.now = now;
  }

  getMenu() {
    const dishes = this.restaurantStore.readMenu();
    const { open, nextOpening } = this.openStatus(this.now());
    return { status: 200, body: { dishes, open, nextOpening } };
  }

  // Open from opening time (inclusive) to closing time (exclusive), server clock, restaurant time zone.
  openStatus(now) {
    const { timeZone, weeklyHours } = this.restaurantStore.readRestaurant();
    const local = localTime(now, timeZone);
    const today = weeklyHours[local.weekday];
    const open = Boolean(today) && toMinutes(today.open) <= local.minutes && local.minutes < toMinutes(today.close);
    if (open) return { open, nextOpening: null };
    for (let i = 0; i <= 7; i++) {
      const day = weeklyHours[(local.weekday + i) % 7];
      if (!day || (i === 0 && local.minutes >= toMinutes(day.open))) continue;
      return { open, nextOpening: zonedTime(local.year, local.month, local.day + i, day.open, timeZone).toISOString() };
    }
    return { open, nextOpening: null };
  }

  placeOrder(submissionId, items) {
    if (typeof submissionId !== 'string' || !/^[\w-]{8,100}$/.test(submissionId)) {
      return { status: 422, body: { reason: 'bad_submission' } };
    }
    return this.orderStore.transaction(() => {
      const found = this.orderStore.findBySubmission(submissionId);
      if (found) return { status: 200, body: confirmation(found) }; // a retry, even after closing
      const refusal = this.validate(items, this.now());
      if (refusal) return { status: 422, body: refusal }; // nothing written, nothing stored
      return { status: 201, body: confirmation(this.orderStore.createOrder(submissionId, items)) };
    });
  }

  // Only for a submissionId not already accepted. Returns null, or the refusal.
  validate(items, now) {
    if (!Array.isArray(items) || items.length === 0) return { reason: 'empty' };
    const goodQuantity = (i) => i && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= MAX_QUANTITY;
    if (!items.every(goodQuantity)) return { reason: 'bad_quantity' };
    const { open, nextOpening } = this.openStatus(now);
    if (!open) return { reason: 'closed', nextOpening };
    const menu = this.restaurantStore.readMenu();
    const byCode = new Map(menu.map((d) => [d.code, d]));
    const stillMatches = (i) => {
      const dish = byCode.get(i.code);
      return dish && dish.available && dish.price === i.price;
    };
    if (!items.every(stillMatches)) return { reason: 'menu_changed', menu };
    return null;
  }
}
