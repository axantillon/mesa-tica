// TrackingView: one order, opened by its private link, kept current by the UpdateCoordinator.

import { createUpdateCoordinator, html, orderLines, patch } from '/assets/shared.js';

const view = document.getElementById('view');
const token = location.pathname.split('/')[2] ?? '';
const coordinator = createUpdateCoordinator();

patch(view, html`<p class="muted" role="status">Loading your order…</p>`);

const showUnavailable = () => {
  patch(view, html`<h1>We couldn't open this tracking link</h1><p>We couldn't open this tracking link. Check the full saved link.</p>`);
};

function guidanceBlock({ number, guidance, status }) {
  if (status === 'Ready') {
    return html`<div class="callout">
      <p><strong>Show order number #${number}.</strong></p>
      <p>${guidance.pickup.instructions}</p>
      <p><strong>Where:</strong> ${guidance.pickup.location}</p>
      <p><strong>Payment:</strong> ${guidance.pickup.payment}</p>
    </div>`;
  }
  if (status === 'Cancelled') {
    return html`<div class="callout callout-stop">
      <p><strong>Reason from the restaurant:</strong> ${guidance.cancellation.reason}</p>
      <p><strong>Contact:</strong> ${guidance.cancellation.contact} (${guidance.cancellation.contactLabel})</p>
    </div>`;
  }
  return '';
}

const WARNING_ID = 'track-warning';
const SUMMARY_ID = 'track-summary';
const CHECKED_ID = 'last-checked';

function render({ data, checked, stale, failed }) {
  if (!data) {
    if (!failed) return;
    patch(view, html`<div class="alert" role="alert"><p><strong>Updates are unavailable.</strong> We can't load this order right now and will keep trying.</p>
      <button id="retry" class="button" data-action="retry">Try again</button></div>`);
    return;
  }
  // Separate regions, so the once-per-poll "last checked" time never rebuilds the order summary.
  patch(view, html`<div id="${WARNING_ID}"></div><div id="${SUMMARY_ID}"></div><p class="muted" id="${CHECKED_ID}"></p>`);
  patch(document.getElementById(WARNING_ID), stale
    ? html`<div class="alert" role="alert"><p><strong>Updates are unavailable. This status may be out of date. Last checked ${checked}.</strong></p>
      <button id="retry" class="button button-quiet" data-action="retry">Try again</button></div>`
    : html``);
  patch(document.getElementById(SUMMARY_ID), html`
    <h1>Order <span class="order-number-inline">#${data.number}</span></h1>
    <section class="status-card" aria-label="Order status">
      <p class="status-label">${stale ? 'Last known status' : 'Current status'}</p>
      <p class="status-name" id="status-name">${data.status}</p>
      <p class="status-message">${data.guidance.message}</p>
    </section>
    ${guidanceBlock(data)}
    ${orderLines(data.items, data.total)}
    <p class="muted">Placed ${data.submitted}</p>
    <p class="muted">Keep this link private. Anyone with it can view this order.</p>`);
  patch(document.getElementById(CHECKED_ID), stale ? html`` : html`Last checked ${checked}`);
}

view.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="retry"]')) coordinator.recover();
});

coordinator.observe({
  path: `/api/track/${encodeURIComponent(token)}`,
  onChange: render,
  onGone: showUnavailable,
  onDenied: showUnavailable,
});
