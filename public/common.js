export const $ = (selector, root = document) => root.querySelector(selector);
export const money = (amount) => '₡' + amount.toLocaleString('en-US');
export const orderNumber = (number) => '#' + String(number).padStart(4, '0');
export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export class RequestError extends Error {
  constructor(status, result) {
    super(result.error ?? result.outcome);
    this.status = status;
    this.result = result;
  }
}

export async function request(path, body, { method = body === undefined ? 'GET' : 'POST', signal } = {}) {
  const timeout = AbortSignal.timeout(3500);
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new RequestError(response.status, result);
  return result;
}

export function localTime(value, timezone = 'America/Costa_Rica', includeDate = false) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, timeStyle: includeDate ? 'short' : 'medium',
    ...(includeDate ? { dateStyle: 'medium' } : {}),
  }).format(new Date(value));
}

export const badge = (status) => `<span class="badge status-${escape(status.toLowerCase())}">${escape(status)}</span>`;

export function itemSummary(order) {
  return `<ul class="summary-lines">${order.items.map((item) => `
    <li><span><strong>${escape(item.name)}</strong><br><small>${item.quantity} × ${money(item.price)}</small></span>
    <strong>${money(item.subtotal)}</strong></li>`).join('')}</ul>
    <div class="total"><span>Total</span><strong>${money(order.total)}</strong></div>`;
}

export const statusMessage = {
  Received: 'The restaurant has received your order. It is not ready for pickup yet.',
  Preparing: 'Your meal is being prepared. It is not ready for pickup yet.',
  Ready: 'Your order is ready for pickup.',
  Collected: 'This order has been collected.',
  Cancelled: 'This order was cancelled.',
};
