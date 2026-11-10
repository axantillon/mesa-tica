export const statuses = ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'];
export const filters = ['Active', ...statuses, 'All'];
export function allowedActions(status) {
  const next = { Received: 'Preparing', Preparing: 'Ready', Ready: 'Collected' }[status];
  return next ? [next, 'Cancelled'] : [];
}

export function opening(restaurant, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: restaurant.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const local = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  const day = local.getUTCDay();
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const today = restaurant.hours[day];
  const isOpen = !!today && minutes >= today[0] && minutes < today[1];
  if (isOpen) return { isOpen, message: 'Open for pickup orders', nextOpening: null };
  for (let offset = 0; offset <= 7; offset++) {
    const hours = restaurant.hours[(day + offset) % 7];
    if (!hours || (offset === 0 && minutes >= hours[0])) continue;
    const date = new Date(local);
    date.setUTCDate(date.getUTCDate() + offset);
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
    }).format(date);
    const hour = Math.floor(hours[0] / 60);
    const time = `${hour % 12 || 12}:${String(hours[0] % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
    return { isOpen: false, nextOpening: `${label}, ${time}`, message: `Ordering is closed. Opens ${label}, ${time} (${restaurant.timezone}).` };
  }
  return { isOpen: false, nextOpening: null, message: `Ordering is currently closed with no upcoming opening. Demo contact — not monitored: ${restaurant.contact}` };
}

export function guidance(order, restaurant) {
  const messages = {
    Received: 'The restaurant has received your order. It is not ready for pickup yet.',
    Preparing: 'Your meal is being prepared. It is not ready for pickup yet.',
    Ready: `Your order is ready for pickup. ${restaurant.pickupInstructions}`,
    Collected: 'This order has been collected.',
    Cancelled: `This order was cancelled. ${order.reason} Demo contact — not monitored: ${restaurant.contact}`,
  };
  return messages[order.status];
}
