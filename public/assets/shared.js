// Browser helpers shared by the customer, tracking and staff pages.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const fragment = (v) => {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(fragment).join('');
  if (typeof v === 'object' && 'raw' in v) return v.raw;
  return String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);
};

/** Template tag that escapes every interpolated value unless it is itself html`...`. */
export const html = (strings, ...values) => ({
  raw: strings.reduce((out, s, i) => out + s + (i < values.length ? fragment(values[i]) : ''), ''),
});

const rendered = new WeakMap();

/** Replaces el's content only when it changed, and keeps keyboard focus on the same control. */
export function patch(el, template) {
  if (rendered.get(el) === template.raw) return;
  rendered.set(el, template.raw);
  const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
  el.innerHTML = template.raw;
  if (focused) document.getElementById(focused)?.focus();
}

export const money = (amount) => `₡${amount.toLocaleString('en-US')}`;

/** The accepted lines of an order, as shown on confirmation, tracking and staff detail. */
export const orderLines = (items, total) => html`
  <table class="lines">
    <caption class="sr-only">Accepted items</caption>
    <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Price</th><th scope="col" class="num">Subtotal</th></tr></thead>
    <tbody>${items.map((item) => html`
      <tr><td>${item.name}</td><td class="num">${item.quantity}</td><td class="num">${money(item.price)}</td><td class="num">${money(item.subtotal)}</td></tr>`)}
    </tbody>
    <tfoot><tr><th scope="row" colspan="3">Total</th><td class="num total">${money(total)}</td></tr></tfoot>
  </table>`;

/** Every failure to obtain a parsed response (offline, timeout, non-JSON) is status 0. */
export async function api(path, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON in browser storage; survives blocked or full storage by keeping working in memory. */
export function createStore(area) {
  const memory = new Map();
  const backend = () => { try { return window[area]; } catch { return null; } };
  return {
    get(key, fallback) {
      try {
        const value = backend()?.getItem(key);
        if (value !== null && value !== undefined) return JSON.parse(value);
      } catch { /* fall through to memory */ }
      return memory.has(key) ? memory.get(key) : fallback;
    },
    set(key, value) {
      memory.set(key, value);
      try { backend()?.setItem(key, JSON.stringify(value)); } catch { /* memory copy still works */ }
    },
    remove(key) {
      memory.delete(key);
      try { backend()?.removeItem(key); } catch { /* nothing to clear */ }
    },
  };
}

/** Random id built on getRandomValues, which also works on plain-http LAN addresses. */
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
