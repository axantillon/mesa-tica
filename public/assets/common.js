/** Browser helpers shared by the customer, tracking and staff pages. */

export function formatCRC(amount) {
  return `₡${amount.toLocaleString('en-US')}`;
}

/** Clock time with seconds in the restaurant's zone, for "last checked" labels. */
export function formatCheckTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
}

export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
}

export function refreshIntervalMs() {
  const value = Number(document.querySelector('meta[name="mesa-refresh-ms"]')?.content);
  return Number.isFinite(value) && value >= 250 ? value : 3000;
}

/** JSON storage that never throws: reads return null and writes return false when storage is unavailable. */
export function safeStorage(kind) {
  let storage = null;
  try {
    storage = window[kind];
  } catch {
    storage = null;
  }
  return {
    get(key) {
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Raised when no usable response arrived (connection failure, timeout or unreadable body). */
export class ConnectionFailure extends Error {}

export async function requestJson(url, { method = 'GET', body, timeoutMs = 10000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ConnectionFailure('No response');
  }
  try {
    return { status: response.status, data: await response.json() };
  } catch {
    throw new ConnectionFailure('Unreadable response');
  }
}

/** Minimal element builder: h('p', { class: 'note' }, 'text', childNode). */
export function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/**
 * Re-renders a region without stealing keyboard focus: an element carrying data-focus-key keeps focus
 * (and its text selection) when the region is rebuilt.
 */
export function replaceContent(container, ...children) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.focusKey : undefined;
  const selection = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  container.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  if (key) {
    const next = container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      if (selection && 'setSelectionRange' in next) {
        try {
          next.setSelectionRange(...selection);
        } catch {
          // Some input types do not support selection ranges.
        }
      }
    }
  }
}

const STATUS_ICONS = { Received: '●', Preparing: '◐', Ready: '✔', Collected: '■', Cancelled: '✕' };

/** Status shown as icon plus words, so meaning never depends on color alone. */
export function statusBadge(status) {
  return h(
    'span',
    { class: `status status-${status.toLowerCase()}` },
    h('span', { class: 'status-icon', 'aria-hidden': 'true' }, STATUS_ICONS[status] ?? '•'),
    ` ${status}`,
  );
}
