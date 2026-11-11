// StaffView: sign-in, shared queue and order detail with revision-bound actions.

import { api, createUpdateCoordinator, html, money, orderLines, patch } from '/assets/shared.js';

const FILTERS = ['Active', 'Received', 'Preparing', 'Ready', 'Collected', 'Cancelled', 'All'];
const ACTION_LABELS = { Preparing: 'Mark Preparing', Ready: 'Mark Ready', Collected: 'Mark Collected' };
const WRITE_TIMEOUT_MS = 8000;

const app = document.getElementById('app');
const coordinator = createUpdateCoordinator();

let employee = null;
let signInNote = null;

// Detail-view state. A draft reason survives refreshes, failures, conflicts and re-authentication.
const drafts = new Map();
let openNumber = null;
let reasonPanelOpen = false;
let chosenAction = null; // { target, revision }: fixed when the employee chooses, released on dismissal or a known outcome
let writing = false;
let detailNote = null;

function route() {
  const match = /^#\/orders(?:\/(\d+))?(?:\?filter=(\w+))?$/.exec(location.hash);
  const filter = FILTERS.includes(match?.[2]) ? match[2] : 'Active';
  return { number: match?.[1] ? Number(match[1]) : null, filter };
}

/* ---------- Sign-in ---------- */

function renderSignIn(username = '') {
  patch(app, html`
    <h1>Mesa Tica staff</h1>
    <p class="muted">Sign in with your staff account. Guests order from the <a href="/">menu</a>.</p>
    ${signInNote ? html`<p class="alert" role="alert">${signInNote}</p>` : ''}
    <form id="sign-in" class="stack" novalidate>
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" autocapitalize="none" required value="${username}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button id="sign-in-button" class="button">Sign in</button>
    </form>`);
}

async function signIn(form) {
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) {
    signInNote = 'Enter your username and password.';
    renderSignIn(username);
    return;
  }
  form.querySelector('button').disabled = true;
  const result = await api('/api/staff/signin', { method: 'POST', body: { username, password } });
  if (result.status === 200) {
    employee = result.data.displayName;
    signInNote = null;
    show();
    return;
  }
  if (result.status === 429) signInNote = 'Too many sign-in attempts. Wait a few minutes, then try again.';
  else if (result.status === 401) signInNote = "We couldn't sign you in. Check your credentials and try again.";
  else signInNote = "We couldn't reach sign-in. Your credentials were not rejected. Check your connection and try again.";
  patch(app, html``); // clears the entered password before re-rendering
  renderSignIn(username);
  document.getElementById('password').focus();
}

function requireSignIn() {
  coordinator.stop();
  employee = null;
  signInNote = 'Your session has expired. Sign in to continue.';
  renderSignIn();
}

async function signOut() {
  const result = await api('/api/staff/signout', { method: 'POST', body: {}, timeoutMs: WRITE_TIMEOUT_MS });
  if (result.status !== 200 && result.status !== 401) {
    const note = document.getElementById('bar-note');
    if (note) note.textContent = 'Sign-out was not confirmed. Try again.';
    return;
  }
  coordinator.stop();
  employee = null;
  drafts.clear();
  reasonPanelOpen = false;
  signInNote = 'You have signed out.';
  renderSignIn();
}

/* ---------- Shared chrome ---------- */

const staffBar = () => html`
  <div class="staff-bar">
    <strong>Mesa Tica staff</strong>
    <span>Signed in as ${employee}</span>
    <span id="bar-note" class="bar-note" role="status"></span>
    <button id="sign-out" class="button button-quiet" data-action="sign-out">Sign out</button>
  </div>`;

/** Stale warning or last-refresh line. Empty until something has loaded. */
function freshness({ checked, stale, data }) {
  if (!data) return html``;
  if (stale) {
    return html`<div class="alert" role="alert"><strong>Updates are unavailable. This information may be out of date. Last refreshed ${checked}.</strong>
      <button id="refresh-now" class="button button-quiet" data-action="refresh">Refresh now</button></div>`;
  }
  return html`<p class="muted" id="last-refresh">Last refreshed ${checked}</p>`;
}

/* ---------- Queue ---------- */

function showQueue(filter) {
  patch(app, html`
    ${staffBar()}
    <h1>Orders</h1>
    <nav class="filters" aria-label="Filter orders">${FILTERS.map((name) => html`
      <a id="filter-${name}" class="filter" href="#/orders?filter=${name}" ${name === filter ? html`aria-current="page"` : ''}>${name}</a>`)}
    </nav>
    <div id="queue-freshness"></div>
    <div id="queue-list" tabindex="-1"><p class="muted" role="status">Loading orders…</p></div>`);
  const freshnessEl = document.getElementById('queue-freshness');
  const listEl = document.getElementById('queue-list');

  coordinator.observe({
    path: `/api/staff/orders?filter=${filter}`,
    onDenied: requireSignIn,
    onChange(state) {
      patch(freshnessEl, freshness(state));
      if (!state.data) {
        if (state.failed) {
          patch(listEl, html`<div class="alert" role="alert"><p>We couldn't load orders. We'll keep trying.</p>
            <button id="retry-queue" class="button button-quiet" data-action="refresh">Try again</button></div>`);
        }
        return;
      }
      const { orders } = state.data;
      if (!orders.length) {
        patch(listEl, html`<p class="empty">${filter === 'Active' ? 'No active orders.' : 'No orders match this filter.'}</p>`);
        return;
      }
      patch(listEl, html`<ul class="queue">${orders.map((order) => html`
        <li><a id="order-${order.number}" class="queue-row" href="#/orders/${order.number}?filter=${filter}">
          <span class="queue-number">#${order.number}</span>
          <span class="status-pill">${order.status}</span>
          <span class="queue-time">${order.submitted}</span>
          <span class="queue-summary">${order.summary}</span>
          <span class="queue-total">${money(order.total)}</span>
        </a></li>`)}</ul>`);
    },
  });
}

/* ---------- Detail ---------- */

function showDetail(number, filter) {
  openNumber = number;
  chosenAction = null;
  writing = false;
  detailNote = null;
  reasonPanelOpen = Boolean(drafts.get(number));

  patch(app, html`
    ${staffBar()}
    <a id="back" class="back" href="#/orders?filter=${filter}">← Back to ${filter} orders</a>
    <div id="detail-freshness"></div>
    <div id="detail-note" tabindex="-1"></div>
    <div id="detail-body"><p class="muted" role="status">Loading order…</p></div>
    <div id="detail-actions" tabindex="-1"></div>
    <section id="reason-panel" class="reason-panel" hidden>
      <label for="cancel-reason"><strong>Reason for cancelling</strong></label>
      <p id="reason-hint" class="muted">The customer will see this reason. Explain why the restaurant can't fulfil the order, and don't include private personal information.</p>
      <textarea id="cancel-reason" rows="3" maxlength="500" aria-describedby="reason-hint reason-error"></textarea>
      <p id="reason-error" class="field-error"></p>
      <div class="actions">
        <button id="review-cancel" class="button button-danger" data-action="review-cancel">Review cancellation</button>
        <button id="close-reason" class="button button-quiet" data-action="close-reason">Keep order</button>
      </div>
    </section>
    <dialog id="cancel-dialog" aria-labelledby="cancel-title">
      <h2 id="cancel-title">Cancel order #${number}?</h2>
      <p>The customer will see this reason.</p>
      <blockquote id="cancel-quote"></blockquote>
      <div class="actions">
        <button id="confirm-cancel" class="button button-danger" data-action="confirm-cancel">Confirm cancellation</button>
        <button id="dismiss-cancel" class="button button-quiet" data-action="dismiss-cancel">Keep order</button>
      </div>
    </dialog>`);

  const textarea = document.getElementById('cancel-reason');
  textarea.value = drafts.get(number) ?? '';
  textarea.addEventListener('input', () => { drafts.set(number, textarea.value); });
  // Native close covers Esc, the Keep order button and a completed confirmation alike.
  document.getElementById('cancel-dialog').addEventListener('close', () => {
    if (!writing) chosenAction = null;
  });

  coordinator.observe({
    path: `/api/staff/orders/${number}`,
    isOlder: (next, shown) => next.revision < shown.revision,
    onDenied: requireSignIn,
    onGone: renderGone,
    onChange: renderDetail,
  });
}

function renderGone() {
  document.getElementById('cancel-dialog')?.close();
  document.getElementById('reason-panel').hidden = true;
  patch(document.getElementById('detail-body'), html`<p class="alert" role="alert">This order is unavailable. Use the link above to return to the queue.</p>`);
  patch(document.getElementById('detail-actions'), html``);
}

function renderDetail(state) {
  const body = document.getElementById('detail-body');
  if (!body) return;
  patch(document.getElementById('detail-freshness'), freshness(state));
  const noteEl = document.getElementById('detail-note');
  patch(noteEl, detailNote ? html`<p class="${detailNote.ok ? 'callout' : 'alert'}" role="status">${detailNote.text}</p>` : html``);

  if (!state.data) {
    if (state.failed) {
      patch(body, html`<div class="alert" role="alert"><p>We couldn't load this order. We'll keep trying.</p>
        <button id="retry-detail" class="button button-quiet" data-action="refresh">Try again</button></div>`);
    }
    return;
  }

  const order = state.data;
  patch(body, html`
    <h1>Order #${order.number}</h1>
    <p class="status-line"><span class="status-pill">${order.status}</span></p>
    <p class="muted">Placed ${order.submitted} (restaurant time)</p>
    ${order.status === 'Cancelled' ? html`<p class="callout callout-stop"><strong>Cancellation reason:</strong> ${order.cancellationReason}</p>` : ''}
    ${orderLines(order.items, order.total)}
    <h2>Status history</h2>
    ${order.history.length
      ? html`<ol class="history">${order.history.map((change) => html`
        <li><strong>${change.fromStatus} → ${change.toStatus}</strong> by ${change.employee}, ${change.time}${change.reason ? html`. Reason: ${change.reason}` : ''}</li>`)}</ol>`
      : html`<p class="muted">No staff changes yet.</p>`}`);

  renderActions(order, state.stale);
}

function renderActions(order, stale) {
  const blocked = stale || writing;
  const canCancel = order.allowedActions.includes('Cancelled');
  const marks = order.allowedActions.filter((target) => target !== 'Cancelled');
  patch(document.getElementById('detail-actions'), html`
    ${order.allowedActions.length ? html`<h2>Next step</h2>` : ''}
    ${stale ? html`<p class="place-why">Refresh before acting. This order may have changed.</p>` : ''}
    <div class="actions">
      ${marks.map((target) => html`<button id="mark-${target}" class="button" data-action="mark" data-target="${target}" ${blocked ? 'disabled' : ''}>${ACTION_LABELS[target]}</button>`)}
      ${canCancel && !reasonPanelOpen ? html`<button id="start-cancel" class="button button-danger-quiet" data-action="start-cancel" ${blocked ? 'disabled' : ''}>Cancel order</button>` : ''}
    </div>`);

  const panel = document.getElementById('reason-panel');
  panel.hidden = !(canCancel && reasonPanelOpen);
  document.getElementById('review-cancel').disabled = blocked;
}

function reviewCancellation() {
  const { data, stale } = coordinator.state;
  if (stale || writing || !data) return;
  const reason = (drafts.get(openNumber) ?? '').trim();
  const error = document.getElementById('reason-error');
  if (!reason) {
    error.textContent = 'Enter the reason the customer will see.';
    document.getElementById('cancel-reason').focus();
    return;
  }
  error.textContent = '';
  chosenAction ??= { target: 'Cancelled', revision: data.revision };
  document.getElementById('cancel-quote').textContent = reason;
  document.getElementById('cancel-dialog').showModal();
}

/** Sends one deliberate change and reports its actual outcome. Never retried automatically. */
async function submitChange({ target, revision }, reason) {
  writing = true;
  detailNote = null;
  renderDetail(coordinator.state);
  const number = openNumber;
  const result = await api(`/api/staff/orders/${number}/status`, {
    method: 'POST',
    body: { revision, target, reason },
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  if (number !== openNumber) return; // employee navigated away; the queue shows the truth
  writing = false;
  chosenAction = null;
  const { outcome } = result.data ?? {};

  if (result.status === 200 && outcome === 'changed') {
    detailNote = { ok: true, text: `Order marked ${target}.` };
    if (target === 'Cancelled') {
      detailNote = { ok: true, text: 'Order cancelled.' };
      drafts.delete(number);
      document.getElementById('cancel-reason').value = '';
      reasonPanelOpen = false;
    }
    coordinator.push(result.data.order);
  } else if (result.status === 409 && outcome === 'conflict') {
    detailNote = { text: `This order changed before your update was saved. It is now ${result.data.order.status}. Review it, then choose an action if one is still needed.` };
    coordinator.push(result.data.order);
  } else if (result.status === 422 && outcome === 'invalid') {
    detailNote = { text: result.data.message };
    coordinator.push(result.data.order);
  } else if (result.status === 401) {
    requireSignIn();
  } else if (result.status === 404) {
    renderGone();
  } else {
    // Outcome unknown: read the actual state before offering any action, and never repeat the write.
    writing = true;
    await coordinator.refresh();
    if (number !== openNumber) return;
    writing = false;
    detailNote = {
      text: coordinator.state.stale
        ? "We couldn't confirm whether that change was saved, and the latest status isn't available yet. Refresh before choosing an action."
        : "We couldn't confirm whether that change was saved. The current status is shown below. Review it before choosing an action.",
    };
    renderDetail(coordinator.state);
  }
  // The button that had focus may be gone now that the status changed.
  if (document.activeElement === document.body && !document.querySelector('dialog[open]')) document.getElementById('detail-note')?.focus();
}

/* ---------- Events and navigation ---------- */

app.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'sign-in') signIn(event.target);
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, target } = button.dataset;
  const { state } = coordinator;
  if (action === 'sign-out') signOut();
  else if (action === 'refresh') coordinator.recover();
  else if (action === 'mark') {
    if (state.data && !state.stale && !writing) submitChange({ target, revision: state.data.revision }, undefined);
  } else if (action === 'start-cancel') {
    if (!state.data || state.stale || writing) return;
    chosenAction = { target: 'Cancelled', revision: state.data.revision };
    reasonPanelOpen = true;
    renderActions(state.data, state.stale);
    document.getElementById('cancel-reason').focus();
  } else if (action === 'close-reason') {
    chosenAction = null;
    reasonPanelOpen = false;
    renderActions(state.data, state.stale);
    document.getElementById('start-cancel')?.focus();
  } else if (action === 'review-cancel') reviewCancellation();
  else if (action === 'dismiss-cancel') document.getElementById('cancel-dialog').close();
  else if (action === 'confirm-cancel') {
    const bound = chosenAction;
    document.getElementById('cancel-dialog').close();
    if (bound) submitChange(bound, drafts.get(openNumber) ?? ''); // sets writing before the dialog's close event runs
  }
});

function show() {
  if (!employee) return renderSignIn();
  const { number, filter } = route();
  if (number === null) {
    if (openNumber !== null) drafts.delete(openNumber);
    openNumber = null;
    showQueue(filter);
  } else {
    showDetail(number, filter);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', show);

const session = await api('/api/staff/session');
if (session.status === 200) {
  employee = session.data.displayName;
  show();
} else if (session.status === 401) {
  renderSignIn();
} else {
  patch(app, html`<h1>Mesa Tica staff</h1><p class="alert" role="alert">We couldn't reach the service. Check your connection, then reload this page.</p>`);
}
