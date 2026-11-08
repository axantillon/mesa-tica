// Small browser helpers shared by the three pages.
export const TIME_ZONE = 'America/Costa_Rica'; // shown times are restaurant time; the server decides open or closed

export const money = (n) => `₡${n.toLocaleString('en-US')}`;
export const clockTime = (when) =>
  new Date(when).toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const dateTime = (when) =>
  new Date(when).toLocaleString('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// h('p', { class: 'x', onclick: fn }, 'text', child) — text is always set as text, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  return fill(el, ...children);
}

// Replaces el's children. null, undefined and false are skipped (replaceChildren would print them as text).
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// JSON request. Network failures throw; any HTTP answer returns { status, body }.
export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
