export const $ = (selector, root = document) => root.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const money = value => `₡${Number(value).toLocaleString('en-US')}`;
export const time = value => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(value));
export const announce = message => { $('#announce').textContent = message; };
export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(7000), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message), { status: response.status });
  return data;
}
export function summary(order) {
  return `<div class="row"><h2>Order #${order.number}</h2><span class="status">${escape(order.status)}</span></div><p class="muted">Placed ${time(order.submittedAt)}</p>${order.items.map(item => `<div class="line"><div><strong>${item.quantity} × ${escape(item.name)}</strong><small>${money(item.price)} each</small></div><span class="price">${money(item.subtotal)}</span></div>`).join('')}<div class="row total"><span>Total</span><span>${money(order.total)}</span></div>`;
}
export function readStorage(kind, key, fallback) {
  try { return JSON.parse(window[kind].getItem(key)) || fallback; } catch { return fallback; }
}
export function writeStorage(kind, key, value) {
  try { window[kind].setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
// Each observer permits only one read in flight. Stopping invalidates late responses.
export function observe(read, success, failure) {
  let stopped = false;
  let timer;
  let busy = false;
  async function refresh() {
    if (stopped || busy) return;
    clearTimeout(timer);
    busy = true;
    try { const result = await read(); if (!stopped) success(result); }
    catch (error) { if (!stopped) failure(error); }
    finally { busy = false; if (!stopped) timer = setTimeout(refresh, 2000); }
  }
  const online = () => refresh();
  window.addEventListener('online', online);
  refresh();
  return { refresh, stop() { stopped = true; clearTimeout(timer); window.removeEventListener('online', online); } };
}
