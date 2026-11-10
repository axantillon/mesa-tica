/**
 * TrackingView: opens one order from its private link and keeps it current through the UpdateCoordinator.
 * Before any successful read it shows no status and no check time; afterwards a failed refresh keeps the
 * last known status with an out-of-date warning (including Ready) until a later refresh succeeds.
 */
import { formatCRC, formatCheckTime, h, refreshIntervalMs, replaceContent, requestJson, statusBadge } from './common.js';
import { createUpdateCoordinator } from './update-coordinator.js';

const privateLink = location.pathname.split('/').pop();
const content = document.getElementById('tracking-content');
const announcer = document.getElementById('status-announcer');

let snapshot = null;
let unavailable = false;
let lastAnnouncedStatus = null;

const coordinator = createUpdateCoordinator({
  intervalMs: refreshIntervalMs(),
  load: async (link, timeoutMs) => {
    const { status, data } = await requestJson(`/api/track/${encodeURIComponent(link)}`, { timeoutMs });
    if (status === 200) return { kind: 'ok', data };
    if (status === 404) return { kind: 'end', reason: 'unavailable' };
    throw new Error('Tracking temporarily unavailable');
  },
  onSuccess: (data) => {
    snapshot = data;
    if (lastAnnouncedStatus && lastAnnouncedStatus !== data.status) announcer.textContent = `Order status updated: ${data.status}.`;
    lastAnnouncedStatus = data.status;
    render();
  },
  onFailure: render,
  onEnd: () => {
    unavailable = true;
    snapshot = null;
    render();
  },
});

function staleWarning(state) {
  if (!state.stale) return null;
  return h(
    'div',
    { class: 'warning stale-warning', role: 'alert' },
    h('p', {}, h('strong', {}, 'Updates are unavailable. This status may be out of date.'), ` Last checked ${formatCheckTime(state.lastSuccessfulCheck, snapshot.timezone)}.`),
    h('p', {}, 'We keep trying automatically.'),
    h('button', { type: 'button', class: 'button secondary', 'data-focus-key': 'retry', onclick: () => coordinator.recover() }, 'Try again now'),
  );
}

function guidanceBlock(order) {
  const guidance = order.guidance;
  const blocks = [h('p', { class: 'status-message' }, guidance.message)];
  if (order.status === 'Ready') {
    blocks.push(
      h(
        'div',
        { class: 'panel pickup' },
        h('p', {}, 'Show order number ', h('strong', { class: 'order-number-inline' }, String(guidance.orderNumber)), ' at the counter.'),
        h('p', {}, 'Pickup location: ', guidance.pickupLocation),
        h('p', {}, guidance.pickupInstructions),
        h('p', {}, h('strong', {}, guidance.paymentStatement)),
      ),
    );
  } else if (order.status === 'Cancelled') {
    blocks.push(
      h(
        'div',
        { class: 'panel cancelled' },
        h('p', {}, 'Reason from the restaurant: ', h('strong', { class: 'cancel-reason' }, guidance.reason ?? 'No reason recorded.')),
        h('p', {}, 'Contact: ', guidance.contact, ` (${guidance.contactLabel})`),
      ),
    );
  } else if (guidance.paymentStatement) {
    blocks.push(h('p', { class: 'help' }, guidance.paymentStatement));
  }
  return blocks;
}

let lastRenderKey = null;

function render() {
  const state = coordinator.state;
  // Skip identical re-renders so repeated failures don't re-announce the same warning.
  const renderKey = JSON.stringify([unavailable, snapshot, state.stale, state.lastSuccessfulCheck]);
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;
  if (unavailable) {
    replaceContent(
      content,
      h('div', { class: 'panel error', role: 'alert' }, h('h1', {}, "We couldn't open this tracking link"), h('p', {}, "We couldn't open this tracking link. Check the full saved link.")),
    );
    return;
  }
  if (!snapshot) {
    replaceContent(
      content,
      state.stale
        ? h(
            'div',
            { class: 'warning', role: 'alert' },
            h('h1', {}, 'Updates are unavailable'),
            h('p', {}, "We couldn't load this order right now. This is a connection or service problem, not a problem with your link. We keep trying automatically."),
            h('button', { type: 'button', class: 'button secondary', 'data-focus-key': 'retry', onclick: () => coordinator.recover() }, 'Try again now'),
          )
        : h('p', { class: 'loading', role: 'status' }, 'Loading your order…'),
    );
    return;
  }
  replaceContent(
    content,
    staleWarning(state),
    h('h1', {}, 'Order ', snapshot.orderNumber),
    h('div', { class: `status-block ${state.stale ? 'is-stale' : ''}` }, h('p', { class: 'status-line' }, 'Status: ', statusBadge(snapshot.status), state.stale ? ' (last known)' : null), guidanceBlock(snapshot)),
    h('p', { class: 'help last-check' }, state.stale ? 'Last successful check: ' : 'Last checked: ', formatCheckTime(state.lastSuccessfulCheck, snapshot.timezone)),
    h('h2', {}, 'Order summary'),
    h('p', {}, `Placed ${snapshot.submittedLabel}`),
    h(
      'ul',
      { class: 'compact-list' },
      snapshot.items.map((item) => h('li', {}, `${item.quantity} × ${item.name} (${formatCRC(item.unitPrice)} each) — ${formatCRC(item.subtotal)}`)),
    ),
    h('p', { class: 'total' }, 'Total ', h('strong', {}, formatCRC(snapshot.total))),
    h('p', { class: 'help' }, snapshot.changesNote),
    h('p', { class: 'help' }, 'Anyone with this link can view this order. Keep it private.'),
  );
}

coordinator.observe(privateLink);
