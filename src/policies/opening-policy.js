/**
 * OpeningPolicy: decides opening state from the restaurant's configured weekly hours and time zone,
 * never the visitor's device zone. Opening times are inclusive and closing times exclusive.
 */
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DAY_SECONDS = 24 * 60 * 60;

function parseClock(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error(`Invalid time "${text}" in restaurant hours; use HH:MM.`);
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60;
  if (seconds > DAY_SECONDS) throw new Error(`Invalid time "${text}" in restaurant hours.`);
  return seconds;
}

/** Intervals for one weekday as [openSeconds, closeSeconds) pairs, sorted by opening time. */
function intervalsFor(restaurant, weekday) {
  return (restaurant.weeklyHours?.[weekday] ?? [])
    .map(({ open, close }) => [parseClock(open), parseClock(close)])
    .filter(([open, close]) => close > open)
    .sort((a, b) => a[0] - b[0]);
}

/** Calendar date, weekday and seconds-since-midnight of an instant in the given zone. */
function localParts(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
    seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

/** Converts a restaurant-local wall-clock time to an instant, correcting for the zone's UTC offset. */
function zonedInstant(year, month, day, seconds, timeZone) {
  const wallClockAsUtc = Date.UTC(year, month - 1, day) + seconds * 1000;
  let guess = wallClockAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const local = localParts(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day) + local.seconds * 1000;
    guess += wallClockAsUtc - localAsUtc;
  }
  return new Date(guess);
}

export function isOpen(restaurant, now) {
  const local = localParts(now, restaurant.timezone);
  return intervalsFor(restaurant, local.weekday).some(([open, close]) => local.seconds >= open && local.seconds < close);
}

/**
 * The next opening strictly after `now` within the coming week, with a local label that always names the
 * weekday and date. Returns null when the weekly schedule has no opening at all.
 */
export function nextOpening(restaurant, now) {
  const today = localParts(now, restaurant.timezone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = WEEKDAYS[date.getUTCDay()];
    for (const [open] of intervalsFor(restaurant, weekday)) {
      const at = zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), open, restaurant.timezone);
      if (at > now) {
        const label = new Intl.DateTimeFormat('en-US', {
          timeZone: restaurant.timezone,
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(at);
        return { at: at.toISOString(), label: `${label} (${restaurant.timezoneLabel ?? restaurant.timezone})` };
      }
    }
  }
  return null;
}

function formatClock(seconds) {
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor((seconds % 3600) / 60);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** Human-readable weekly hours, collapsing an identical schedule on all seven days into one line. */
export function describeHours(restaurant) {
  const order = [...WEEKDAYS.slice(1), WEEKDAYS[0]];
  const byDay = order.map((weekday) => ({
    weekday,
    text: intervalsFor(restaurant, weekday)
      .map(([open, close]) => `${formatClock(open)} – ${formatClock(close)}`)
      .join(', '),
  }));
  if (byDay.every((day) => !day.text)) return [];
  if (byDay.every((day) => day.text === byDay[0].text)) return [`Every day: ${byDay[0].text}`];
  return byDay.map(({ weekday, text }) => `${weekday[0].toUpperCase()}${weekday.slice(1)}: ${text || 'Closed'}`);
}
