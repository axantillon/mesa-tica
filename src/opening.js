const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function openingState(restaurant, now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: restaurant.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type) => Number(parts.find((value) => value.type === type).value);
  const date = Date.UTC(part('year'), part('month') - 1, part('day'));
  const today = new Date(date).getUTCDay();
  const minute = part('hour') * 60 + part('minute');
  const interval = restaurant.hours[today];
  if (interval && minute >= minutes(interval[0]) && minute < minutes(interval[1])) {
    return { open: true, next: null };
  }
  for (let offset = 0; offset <= 7; offset++) {
    const hours = restaurant.hours[(today + offset) % 7];
    if (hours && (offset > 0 || minute < minutes(hours[0]))) {
      return {
        open: false,
        next: { date: new Date(date + offset * 86400000).toISOString().slice(0, 10), time: hours[0] },
      };
    }
  }
  return { open: false, next: null };
}

