// OpeningPolicy and OrderLifecycle: pure business decisions, plus restaurant-local time labels.

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LOCAL_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

function localClock(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  const date = Date.UTC(+parts.year, +parts.month - 1, +parts.day); // the local calendar date, as a UTC midnight
  return { date, weekday: new Date(date).getUTCDay(), minutes: +parts.hour * 60 + +parts.minute };
}

function clockLabel(minutes) {
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Opening is inclusive, closing exclusive, evaluated in the restaurant's zone. */
export function isOpen(restaurant, now) {
  const { weekday, minutes } = localClock(now, restaurant.timezone);
  const hours = restaurant.openingHours[weekday];
  return Boolean(hours) && minutes >= hours.open && minutes < hours.close;
}

/** Label of the next opening, or null when the weekly schedule has none. */
export function nextOpening(restaurant, now) {
  const { date, weekday, minutes } = localClock(now, restaurant.timezone);
  for (let days = 0; days <= 7; days++) {
    const hours = restaurant.openingHours[(weekday + days) % 7];
    if (hours && (days > 0 || minutes < hours.open)) {
      return `${LOCAL_DATE.format(date + days * DAY_MS)}, ${clockLabel(hours.open)}`;
    }
  }
  return null;
}

export function hoursLabel(restaurant) {
  const runs = [];
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const hours = restaurant.openingHours[day];
    const text = hours ? `${clockLabel(hours.open)} to ${clockLabel(hours.close)}` : 'closed';
    if (runs.at(-1)?.text === text) runs.at(-1).to = day;
    else runs.push({ from: day, to: day, text });
  }
  return runs
    .map(({ from, to, text }) => `${WEEKDAYS[from]}${from === to ? '' : ` through ${WEEKDAYS[to]}`}, ${text}`)
    .join('; ');
}

export const dateTimeLabel = (ms, timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(ms));

export const timeLabel = (ms, timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit',
}).format(new Date(ms));

const NEXT_STATUSES = {
  Received: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'],
  Ready: ['Collected', 'Cancelled'],
  Collected: [],
  Cancelled: [],
};

export const MAX_REASON_LENGTH = 500;

export const allowedActions = (status) => NEXT_STATUSES[status] ?? [];

/** Returns a correction message, or null when the change is legal. */
export function validateChange(status, target, reason) {
  if (!allowedActions(status).includes(target)) return `An order that is ${status} cannot change to ${target}.`;
  if (target === 'Cancelled') {
    if (typeof reason !== 'string' || !reason.trim()) return 'Enter the reason the customer will see.';
    if (reason.trim().length > MAX_REASON_LENGTH) return `Keep the reason to ${MAX_REASON_LENGTH} characters.`;
  }
  return null;
}
