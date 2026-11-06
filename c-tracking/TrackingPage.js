// C · TrackingPage: the order from its private link (C1), live status (C2), what to do when Ready or Cancelled (C3).
import { Poller, finalError } from '../shared/Poller.js';
import { money, clockTime, dateTime, h, api } from '../shared/ui.js';

const EXPLAIN = {
  Received: 'The restaurant has your order. The kitchen will start on it soon. Not ready yet.',
  Preparing: 'The kitchen is working on your meal. Not ready yet.',
  Ready: 'Your order is ready. You can collect it now.',
  Collected: 'Your order has been collected. Enjoy your meal!',
  Cancelled: 'The restaurant cancelled your order.',
};
const FINAL = ['Collected', 'Cancelled'];
const token = location.pathname.split('/')[2] ?? '';
const view = document.getElementById('tracking');
const check = document.getElementById('check');
const announce = document.getElementById('announce');
let shown = '';
let warned = false;

function renderOrder(o) {
  view.replaceChildren(
    h('h2', {}, `Order #${o.number}`),
    h('p', { class: `status-big s-${o.status}` }, o.status),
    h('p', {}, EXPLAIN[o.status]),
    o.status === 'Ready' && h('div', { class: 'callout ok' },
      h('p', {}, h('strong', {}, `Order number #${o.number}`)),
      h('p', {}, o.collectionInstructions)),
    o.status === 'Cancelled' && h('div', { class: 'callout warn' },
      h('p', {}, 'Reason: ', h('strong', {}, o.cancellationReason)),
      h('p', {}, 'To make other arrangements, contact the restaurant: ', o.contact)),
    h('h3', {}, 'Your items'),
    h('ul', { class: 'lines' }, o.lines.map((l) => h('li', {}, `${l.quantity} × ${l.dishName}`, h('span', { class: 'line-total' }, money(l.price * l.quantity))))),
    h('p', { class: 'total' }, 'Total ', h('strong', {}, money(o.total)), o.status !== 'Cancelled' && ' · pay at collection'),
    h('p', { class: 'muted' }, `Ordered ${dateTime(o.submittedAt)}`),
  );
}

function render(p) {
  if (p.stopReason?.status === 404) {
    check.hidden = true;
    view.replaceChildren(h('h2', {}, 'Link not valid'), h('p', {}, 'No order matches this link. Check that you copied the whole link.'));
    return;
  }
  const o = p.data;
  if (o && JSON.stringify(o) !== shown) {
    shown = JSON.stringify(o);
    renderOrder(o);
    announce.textContent = `Order ${o.number}: ${o.status}.`;
  }
  if (o && FINAL.includes(o.status)) p.stop(); // nothing can change after Collected or Cancelled
  if (p.warning !== warned) announce.textContent = p.warning ? 'Updates unavailable.' : `Updates resumed. Order ${o?.number}: ${o?.status}.`;
  warned = p.warning;
  view.classList.toggle('stale', p.warning);
  check.className = `banner ${p.warning ? 'warn' : 'ok'}`;
  if (p.warning) {
    check.textContent = o
      ? `Updates unavailable. The status shown may be out of date: last successful check ${clockTime(p.lastSuccess)}. Trying again…`
      : 'Updates unavailable. Check your connection. Trying again…';
  } else {
    check.textContent = p.stopped ? `Final status. Last checked ${clockTime(p.lastSuccess)}.` : `Last checked ${clockTime(p.lastSuccess)}. Updates every few seconds.`;
  }
}

new Poller(async (signal) => {
  const { status, body } = await api(`/api/track/${encodeURIComponent(token)}`, { signal });
  if (status === 404) throw finalError(404);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return body;
}).start(render);
