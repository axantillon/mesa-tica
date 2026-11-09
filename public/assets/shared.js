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
  if (focused !== null) (document.getElementById(focused) ?? (el.hasAttribute('tabindex') ? el : null))?.focus();
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

/**
 * UpdateCoordinator: keeps one target current by polling (roughly every 2 s, with a 3 s timeout).
 * A check only counts when a successful response arrives; failures keep the last data and mark it
 * stale; older responses are ignored; staff writes never pass through here, so none are repeated.
 *
 * target: { path, onChange({ data, checked, stale, failed }), onDenied(), onGone(), isOlder?(next, shown) }
 */
export function createUpdateCoordinator() {
  const POLL_MS = 2000;
  const TIMEOUT_MS = 3000;
  let target = null;
  let timer = null;
  let requests = 0;
  let appliedRequest = 0;
  let state = null;

  const publish = (changes) => {
    state = { ...state, ...changes };
    target.onChange(state);
  };

  async function refresh() {
    const current = target;
    if (!current) return;
    clearTimeout(timer);
    const request = ++requests;
    const result = await api(current.path, { timeoutMs: TIMEOUT_MS });
    if (current !== target || request < appliedRequest) return;

    if (result.status === 401 && result.data?.outcome === 'sign_in_required') {
      stop();
      current.onDenied();
      return;
    }
    if (result.status === 404 && ['link_unavailable', 'unavailable'].includes(result.data?.outcome)) {
      stop();
      current.onGone();
      return;
    }
    if (result.status === 200) {
      if (!state.data || !current.isOlder?.(result.data, state.data)) {
        appliedRequest = request;
        publish({ data: result.data, checked: result.data.checked, stale: false, failed: false });
      }
    } else {
      publish(state.data ? { stale: true } : { failed: true });
    }
    clearTimeout(timer);
    timer = setTimeout(refresh, POLL_MS);
  }

  function stop() {
    target = null;
    clearTimeout(timer);
  }

  function observe(next) {
    stop();
    target = next;
    state = { data: null, checked: null, stale: false, failed: false };
    appliedRequest = requests;
    refresh();
  }

  /** Applies data already known to be current (a write's response), superseding requests in flight. */
  function push(data) {
    if (!target) return; // the view already closed, for example on session expiry
    appliedRequest = ++requests;
    publish({ data, checked: data.checked, stale: false, failed: false });
  }

  const recover = () => (target ? refresh() : Promise.resolve());
  window.addEventListener('online', recover);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recover(); });

  return { observe, refresh: recover, recover, push, stop, get state() { return state; } };
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
