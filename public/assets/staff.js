/**
 * StaffView: sign-in, filtered queue, order detail and status changes.
 *
 * - Every action carries the revision of the detail shown when the employee chose it. While an action is
 *   being confirmed or submitted, background refreshes are held back so they cannot change that revision;
 *   the newest detail is applied after dismissal or a known outcome.
 * - A rejected (conflict/invalid) or uncertain write is never resent automatically.
 * - A typed cancellation reason is kept in sessionStorage per order, survives refresh failures and
 *   same-tab reauthentication, and is only restored for that same order after its current state loads.
 * - When access is lost, all protected order data is removed from the page before asking to sign in.
 */
import { formatCRC, formatCheckTime, h, refreshIntervalMs, replaceContent, requestJson, safeStorage, statusBadge } from './common.js';
import { createUpdateCoordinator } from './update-coordinator.js';

const FILTERS = ['Active', 'Received', 'Preparing', 'Ready', 'Collected', 'Cancelled', 'All'];
const DRAFT_KEY = 'mesa.staff.cancelDraft';
const tab = safeStorage('sessionStorage');

const elements = {
  sessionCheck: document.getElementById('session-check'),
  account: document.getElementById('staff-account'),
  signInView: document.getElementById('signin-view'),
  signInMessage: document.getElementById('signin-message'),
  signInForm: document.getElementById('signin-form'),
  signInButton: document.getElementById('signin-button'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  workspace: document.getElementById('workspace'),
  dialog: document.getElementById('cancel-dialog'),
  dialogTitle: document.getElementById('cancel-dialog-title'),
  dialogReason: document.getElementById('cancel-dialog-reason'),
  dialogKeep: document.getElementById('cancel-dialog-keep'),
  dialogConfirm: document.getElementById('cancel-dialog-confirm'),
};

let ws = null; // workspace elements, present only while signed in

const view = {
  employee: null,
  route: null,
  timezone: 'America/Costa_Rica',
  queue: null,
  queueStale: false,
  queueCheckedAt: null,
  detail: null,
  detailStale: false,
  detailCheckedAt: null,
  detailUnavailable: false,
  bufferedDetail: null,
  observedRevision: null,
  action: null,
  actionMessage: null,
  reasonError: null,
  draftNote: null,
  restoreDraftAfterSignIn: false,
  accountMessage: null,
};

// ---------- draft cancellation reason ----------

function readDraft() {
  return tab.get(DRAFT_KEY);
}

function saveDraft(orderNumber, reason) {
  if (reason === '') tab.remove(DRAFT_KEY);
  else tab.set(DRAFT_KEY, { orderNumber, reason });
}

function clearDraft() {
  tab.remove(DRAFT_KEY);
}

// ---------- routing ----------

function parseRoute() {
  const match = /^#\/orders(?:\/(\d{1,9}))?(?:\?(.*))?$/.exec(location.hash);
  const filter = new URLSearchParams(match?.[2] ?? '').get('filter');
  return { number: match?.[1] ? Number(match[1]) : null, filter: FILTERS.includes(filter) ? filter : 'Active' };
}

const queueHref = (filter) => `#/orders?filter=${filter}`;
const detailHref = (number, filter) => `#/orders/${number}?filter=${filter}`;

// ---------- update coordinator ----------

const coordinator = createUpdateCoordinator({
  intervalMs: refreshIntervalMs(),
  load: async (target, timeoutMs) => {
    const url = target.kind === 'queue' ? `/api/staff/orders?filter=${encodeURIComponent(target.filter)}` : `/api/staff/orders/${target.number}`;
    const { status, data } = await requestJson(url, { timeoutMs });
    if (status === 200) return { kind: 'ok', data };
    if (status === 401) return { kind: 'end', reason: 'access' };
    if (status === 404 && target.kind === 'detail') return { kind: 'end', reason: 'not_found' };
    throw new Error('Refresh failed');
  },
  onSuccess: (data, state, target) => {
    if (target.kind === 'queue') {
      view.queue = data;
      view.timezone = data.timezone;
      view.queueStale = false;
      view.queueCheckedAt = state.lastSuccessfulCheck;
      renderQueue();
    } else if (view.action) {
      // Hold the refresh: the employee's chosen revision must not change during confirmation/submission.
      view.bufferedDetail = { order: data.order, checkedAt: state.lastSuccessfulCheck };
    } else {
      applyDetail(data.order, state.lastSuccessfulCheck);
    }
  },
  onFailure: (state, target) => {
    if (target.kind === 'queue') {
      view.queueStale = true;
      renderQueue();
    } else {
      view.detailStale = true;
      renderDetail();
    }
  },
  onEnd: (outcome) => {
    if (outcome.reason === 'access') return handleAccessLost();
    view.detailUnavailable = true;
    view.detail = null;
    renderDetail();
  },
});

/** Shows a detail snapshot unless it is older than the one already shown (revisions only increase). */
function applyDetail(order, checkedAt) {
  if (view.detail && view.detail.number === order.number && order.revision < view.detail.revision) return;
  view.detail = order;
  view.timezone = order.timezone;
  view.observedRevision = order.revision;
  view.detailCheckedAt = checkedAt;
  view.detailStale = false;
  view.detailUnavailable = false;
  renderDetail();
}

function releaseHeldRefresh() {
  if (view.bufferedDetail) applyDetail(view.bufferedDetail.order, view.bufferedDetail.checkedAt);
  view.bufferedDetail = null;
  coordinator.refresh();
}

// ---------- sign-in / access ----------

function showSignIn(message) {
  elements.sessionCheck.hidden = true;
  elements.workspace.hidden = true;
  elements.signInView.hidden = false;
  replaceContent(elements.account);
  replaceContent(
    elements.signInMessage,
    message ? h('p', { class: message.kind === 'info' ? 'notice' : 'warning', role: 'alert' }, message.text) : null,
  );
}

function setSignInBusy(busy) {
  elements.signInButton.disabled = busy;
  elements.signInButton.textContent = busy ? 'Signing in…' : 'Sign in';
}

async function signIn(event) {
  event.preventDefault();
  const username = elements.username.value.trim();
  const password = elements.password.value;
  if (!username || !password) {
    showSignIn({ kind: 'warning', text: 'Enter your username and password.' });
    (username ? elements.password : elements.username).focus();
    return;
  }
  setSignInBusy(true);
  let response = null;
  try {
    response = await requestJson('/api/staff/session', { method: 'POST', body: { username, password }, timeoutMs: 10000 });
  } catch {
    response = null;
  }
  setSignInBusy(false);
  if (response?.status === 200) {
    elements.password.value = '';
    view.employee = response.data.employee;
    view.restoreDraftAfterSignIn = true;
    enterWorkspace();
    return;
  }
  let text;
  if (!response) text = "We couldn't reach the sign-in service. Check your connection and try again. Your credentials were not rejected.";
  else if (response.status === 401) text = "We couldn't sign you in. Check your credentials and try again.";
  else if (response.status === 429) text = response.data.message;
  else if (response.status === 400) text = 'Enter your username and password.';
  else text = 'Sign-in is temporarily unavailable because of a service problem. Try again in a moment.';
  showSignIn({ kind: 'warning', text });
  elements.password.focus();
}

/** Access denied or expired: stop protected updates and remove every protected detail from the page. */
function handleAccessLost() {
  coordinator.stop();
  view.action = null;
  if (elements.dialog.open) elements.dialog.close();
  tearDownWorkspace();
  const draft = readDraft();
  showSignIn({
    kind: 'warning',
    text: `Your staff session has ended. Sign in to continue.${draft ? ` Your cancellation reason for order ${draft.orderNumber} is kept in this tab.` : ''}`,
  });
  elements.username.focus();
}

async function signOut() {
  let response = null;
  try {
    response = await requestJson('/api/staff/session', { method: 'DELETE', timeoutMs: 8000 });
  } catch {
    response = null;
  }
  if (response?.status !== 200) {
    view.accountMessage = 'Sign-out not confirmed. Try again.';
    renderAccount();
    return;
  }
  coordinator.stop();
  clearDraft();
  tearDownWorkspace();
  showSignIn({ kind: 'info', text: 'You have signed out.' });
}

function renderAccount() {
  if (!view.employee) return replaceContent(elements.account);
  replaceContent(
    elements.account,
    h('span', { class: 'account-name' }, `Signed in as ${view.employee.displayName}`),
    h('button', { type: 'button', class: 'button secondary', onclick: signOut }, 'Sign out'),
    view.accountMessage ? h('span', { class: 'field-error', role: 'alert' }, view.accountMessage) : null,
  );
}

// ---------- workspace ----------

function buildWorkspace() {
  const reason = h('textarea', {
    id: 'cancel-reason',
    rows: '3',
    maxlength: '300',
    'aria-describedby': 'cancel-reason-help cancel-reason-error',
  });
  const cancelButton = h('button', { type: 'submit', class: 'button danger', id: 'cancel-order-button' }, 'Cancel order');
  const cancelForm = h(
    'form',
    { id: 'cancel-form', class: 'panel cancel-form', novalidate: true, hidden: true },
    h('h2', {}, 'Cancel this order'),
    h('label', { for: 'cancel-reason' }, 'Reason for cancelling (shown to the customer)'),
    h('p', { id: 'cancel-reason-help', class: 'help' }, "Explain why the order can't be fulfilled. Don't include personal information."),
    reason,
    h('p', { id: 'cancel-reason-error', class: 'field-error', role: 'alert' }),
    cancelButton,
  );
  reason.addEventListener('input', () => {
    if (view.detail) saveDraft(view.detail.number, reason.value);
    if (view.reasonError && reason.value.trim()) {
      view.reasonError = null;
      renderReasonError();
    }
  });
  cancelForm.addEventListener('submit', (event) => {
    event.preventDefault();
    openCancelConfirmation();
  });

  ws = {
    queueView: h('section', { class: 'queue-view', 'aria-labelledby': 'queue-heading' }),
    queueFilters: h('nav', { 'aria-label': 'Order filters' }),
    queueFreshness: h('div', { class: 'freshness' }),
    queueList: h('div', {}),
    detailView: h('section', { class: 'detail-view', 'aria-labelledby': 'detail-heading' }),
    backLink: h('a', { class: 'back-link' }),
    detailFreshness: h('div', { class: 'freshness' }),
    detailInfo: h('div', {}),
    actionMessage: h('div', { 'aria-live': 'polite' }),
    detailActions: h('div', { class: 'actions' }),
    draftNote: h('div', {}),
    cancelForm,
    reason,
    cancelButton,
    history: h('div', {}),
    shownOrderNumber: null,
  };
  ws.queueView.append(h('h1', { id: 'queue-heading' }, 'Orders'), ws.queueFilters, ws.queueFreshness, ws.queueList);
  ws.detailView.append(
    h('p', {}, ws.backLink),
    ws.detailFreshness,
    ws.detailInfo,
    ws.actionMessage,
    ws.detailActions,
    ws.draftNote,
    ws.cancelForm,
    ws.history,
  );
  elements.workspace.replaceChildren(ws.queueView, ws.detailView);
  lastQueueKey = null;
}

function tearDownWorkspace() {
  elements.workspace.replaceChildren();
  elements.workspace.hidden = true;
  ws = null;
  Object.assign(view, {
    employee: null,
    queue: null,
    queueStale: false,
    queueCheckedAt: null,
    detail: null,
    detailStale: false,
    detailCheckedAt: null,
    detailUnavailable: false,
    bufferedDetail: null,
    observedRevision: null,
    action: null,
    actionMessage: null,
    reasonError: null,
    draftNote: null,
    accountMessage: null,
  });
}

function enterWorkspace() {
  elements.sessionCheck.hidden = true;
  elements.signInView.hidden = true;
  replaceContent(elements.signInMessage);
  elements.workspace.hidden = false;
  buildWorkspace();
  renderAccount();
  route();
}

function route() {
  if (!ws) return;
  const previous = view.route;
  view.route = parseRoute();
  if (elements.dialog.open) {
    view.action = null;
    elements.dialog.close();
  }
  view.action = null;
  view.bufferedDetail = null;
  if (view.route.number !== null) {
    ws.queueView.hidden = true;
    ws.detailView.hidden = false;
    if (previous?.number !== view.route.number || ws.shownOrderNumber === null) {
      Object.assign(view, { detail: null, detailStale: false, detailCheckedAt: null, detailUnavailable: false, actionMessage: null, reasonError: null, draftNote: null });
      ws.shownOrderNumber = null;
    }
    renderDetail();
    coordinator.observe({ kind: 'detail', number: view.route.number });
  } else {
    ws.queueView.hidden = false;
    ws.detailView.hidden = true;
    if (previous?.filter !== view.route.filter || previous?.number !== null) {
      Object.assign(view, { queue: null, queueStale: false, queueCheckedAt: null });
    }
    renderQueue();
    coordinator.observe({ kind: 'queue', filter: view.route.filter });
  }
  view.restoreDraftAfterSignIn = view.restoreDraftAfterSignIn && view.route.number !== null;
}

// ---------- queue ----------

function freshness({ stale, checkedAt, hasData, subject }) {
  if (!hasData) {
    return stale
      ? h(
          'div',
          { class: 'warning', role: 'alert' },
          h('p', {}, `We couldn't load ${subject}. This is a connection or service problem. We keep trying automatically.`),
          h('button', { type: 'button', class: 'button secondary', 'data-focus-key': 'retry', onclick: () => coordinator.recover() }, 'Try again now'),
        )
      : h('p', { class: 'loading', role: 'status' }, `Loading ${subject}…`);
  }
  const time = formatCheckTime(checkedAt, view.timezone);
  if (stale) {
    return h(
      'div',
      { class: 'warning stale-warning', role: 'alert' },
      h('p', {}, h('strong', {}, 'Updates are unavailable. This information may be out of date.'), ` Last successful refresh ${time}.`),
      h('button', { type: 'button', class: 'button secondary', 'data-focus-key': 'retry', onclick: () => coordinator.recover() }, 'Try again now'),
    );
  }
  return h('p', { class: 'help last-refresh' }, `Last successful refresh ${time}`);
}

let lastQueueKey = null;

function renderQueue() {
  if (!ws) return;
  const { filter } = view.route;
  const key = JSON.stringify([filter, view.queue, view.queueStale, view.queueCheckedAt]);
  if (key === lastQueueKey) return;
  lastQueueKey = key;

  replaceContent(
    ws.queueFilters,
    h(
      'ul',
      { class: 'filters' },
      FILTERS.map((name) =>
        h('li', {}, h('a', { href: queueHref(name), class: 'filter', 'aria-current': name === filter ? 'page' : null, 'data-focus-key': `filter-${name}` }, name)),
      ),
    ),
  );
  replaceContent(ws.queueFreshness, freshness({ stale: view.queueStale, checkedAt: view.queueCheckedAt, hasData: Boolean(view.queue), subject: 'orders' }));

  if (!view.queue) return replaceContent(ws.queueList);
  const orders = view.queue.orders;
  if (orders.length === 0) {
    return replaceContent(ws.queueList, h('p', { class: 'empty' }, filter === 'Active' ? 'No active orders.' : 'No orders match this filter.'));
  }
  replaceContent(
    ws.queueList,
    h(
      'ol',
      { class: 'order-list', 'aria-label': `${filter} orders, oldest first` },
      orders.map((order) =>
        h(
          'li',
          { class: 'order-card' },
          h(
            'a',
            { href: detailHref(order.number, filter), 'data-focus-key': `order-${order.number}`, 'data-order-number': String(order.number) },
            h('span', { class: 'order-card-number' }, `Order ${order.number}`),
            h('span', { class: 'order-card-time' }, order.submittedLabel),
            statusBadge(order.status),
            h('span', { class: 'order-card-items' }, order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')),
            h('span', { class: 'order-card-total' }, formatCRC(order.total)),
          ),
        ),
      ),
    ),
  );
}

// ---------- detail ----------

function renderReasonError() {
  if (!ws) return;
  const error = ws.cancelForm.querySelector('#cancel-reason-error');
  error.textContent = view.reasonError ?? '';
  ws.reason.setAttribute('aria-invalid', view.reasonError ? 'true' : 'false');
}

function renderDetail() {
  if (!ws) return;
  const { filter, number } = view.route;
  ws.backLink.href = queueHref(filter);
  ws.backLink.textContent = `← Back to ${filter} orders`;

  if (view.detailUnavailable) {
    replaceContent(ws.detailFreshness);
    replaceContent(ws.detailInfo, h('h1', { id: 'detail-heading' }, `Order ${number}`), h('p', { class: 'warning', role: 'alert' }, 'This order is unavailable. Return to the queue.'));
    replaceContent(ws.detailActions);
    replaceContent(ws.history);
    ws.cancelForm.hidden = true;
    return;
  }

  replaceContent(ws.detailFreshness, freshness({ stale: view.detailStale, checkedAt: view.detailCheckedAt, hasData: Boolean(view.detail), subject: 'this order' }));
  const order = view.detail;
  if (!order) {
    replaceContent(ws.detailInfo, h('h1', { id: 'detail-heading' }, `Order ${number}`));
    replaceContent(ws.detailActions);
    replaceContent(ws.history);
    ws.cancelForm.hidden = true;
    return;
  }

  if (ws.shownOrderNumber !== order.number) {
    // First display of this order: restore only a draft written for this same order.
    ws.shownOrderNumber = order.number;
    const draft = readDraft();
    ws.reason.value = draft?.orderNumber === order.number ? draft.reason : '';
    if (draft?.orderNumber === order.number && view.restoreDraftAfterSignIn) {
      view.draftNote = `Your cancellation reason for order ${order.number} was kept. Review the current order below, then choose Cancel order again if it still applies.`;
    }
    view.restoreDraftAfterSignIn = false;
  }

  replaceContent(
    ws.detailInfo,
    h('h1', { id: 'detail-heading' }, `Order ${order.number}`),
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, 'Submitted'),
      h('dd', {}, order.submittedLabel),
      h('dt', {}, 'Status'),
      h('dd', {}, statusBadge(order.status), view.detailStale ? ' (last known)' : null),
    ),
    h(
      'table',
      { class: 'items' },
      h('caption', { class: 'visually-hidden' }, 'Accepted items'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Item'), h('th', { scope: 'col' }, 'Qty'), h('th', { scope: 'col' }, 'Price'), h('th', { scope: 'col' }, 'Subtotal'))),
      h(
        'tbody',
        {},
        order.items.map((item) =>
          h('tr', {}, h('td', {}, item.name), h('td', {}, String(item.quantity)), h('td', {}, formatCRC(item.unitPrice)), h('td', {}, formatCRC(item.subtotal))),
        ),
      ),
      h('tfoot', {}, h('tr', {}, h('th', { scope: 'row', colspan: '3' }, 'Total'), h('td', {}, h('strong', {}, formatCRC(order.total))))),
    ),
    order.cancellationReason ? h('p', { class: 'panel cancelled' }, 'Cancellation reason (shown to the customer): ', h('strong', {}, order.cancellationReason)) : null,
  );

  replaceContent(
    ws.actionMessage,
    view.actionMessage ? h('p', { class: `action-message ${view.actionMessage.kind}`, role: view.actionMessage.kind === 'progress' ? 'status' : 'alert' }, view.actionMessage.text) : null,
  );

  const busy = view.action !== null;
  const actions = order.allowedActions.filter((action) => action.target !== 'Cancelled');
  const canCancel = order.allowedActions.some((action) => action.target === 'Cancelled');
  if (order.allowedActions.length === 0) {
    replaceContent(ws.detailActions, h('p', { class: 'help' }, `This order is ${order.status}, which is final. No further changes are possible.`));
  } else if (view.detailStale) {
    replaceContent(ws.detailActions, h('p', { class: 'warning' }, 'Actions are paused because this order may be out of date. Wait for a successful refresh before changing it. Any reason you typed is kept.'));
  } else {
    replaceContent(
      ws.detailActions,
      h(
        'div',
        { class: 'button-row' },
        actions.map((action) =>
          h(
            'button',
            { type: 'button', class: 'button primary', 'data-focus-key': `action-${action.target}`, disabled: busy, onclick: () => chooseAction(action.target) },
            action.label,
          ),
        ),
      ),
    );
  }
  ws.cancelForm.hidden = !canCancel;
  ws.cancelButton.disabled = busy || view.detailStale;
  renderReasonError();

  const draft = readDraft();
  const note = view.draftNote ?? (draft?.orderNumber === order.number && !canCancel ? `A saved cancellation reason can't be used because this order is now ${order.status}.` : null);
  replaceContent(ws.draftNote, note ? h('p', { class: 'notice' }, note) : null);

  replaceContent(
    ws.history,
    h('h2', {}, 'Status history'),
    h(
      'ol',
      { class: 'history' },
      h('li', {}, `Order placed as Received — ${order.submittedLabel}`),
      order.history.map((change) =>
        h(
          'li',
          {},
          `${change.fromStatus} → ${change.toStatus} by ${change.employeeName} — ${change.timeLabel}`,
          change.reason ? h('span', { class: 'history-reason' }, ` Reason: ${change.reason}`) : null,
        ),
      ),
    ),
  );
}

// ---------- status changes ----------

function chooseAction(target) {
  if (view.action || view.detailStale || !view.detail) return;
  view.draftNote = null;
  view.action = { target, revision: view.observedRevision, phase: 'submitting' };
  submitChange();
}

function openCancelConfirmation() {
  if (view.action || view.detailStale || !view.detail) return;
  const reason = ws.reason.value;
  if (reason.trim() === '') {
    view.reasonError = 'Enter a reason for cancelling. The customer will see it.';
    renderReasonError();
    ws.reason.focus();
    return;
  }
  view.reasonError = null;
  view.draftNote = null;
  view.action = { target: 'Cancelled', revision: view.observedRevision, reason, phase: 'confirming' };
  elements.dialogTitle.textContent = `Cancel order ${view.detail.number}? The customer will see this reason.`;
  elements.dialogReason.textContent = reason.trim();
  renderDetail();
  elements.dialog.showModal();
  elements.dialogKeep.focus();
}

/** Dismissal changes nothing: the typed reason stays and focus returns to the Cancel order button. */
function dismissCancel() {
  if (view.action?.phase !== 'confirming') return;
  view.action = null;
  if (elements.dialog.open) elements.dialog.close();
  releaseHeldRefresh();
  renderDetail();
  ws?.cancelButton.focus();
}

function confirmCancel() {
  if (view.action?.phase !== 'confirming') return;
  view.action.phase = 'submitting';
  elements.dialog.close();
  submitChange();
}

async function submitChange() {
  const { target, revision, reason } = view.action;
  const number = view.detail.number;
  view.actionMessage = { kind: 'progress', text: target === 'Cancelled' ? 'Cancelling the order…' : `Saving: ${target}…` };
  renderDetail();

  let response = null;
  try {
    response = await requestJson(`/api/staff/orders/${number}/status`, {
      method: 'POST',
      body: target === 'Cancelled' ? { revision, target, reason } : { revision, target },
      timeoutMs: 10000,
    });
  } catch {
    response = null;
  }
  if (!ws) return;
  view.action = null;
  view.bufferedDetail = null;
  const data = response?.data;

  if (response?.status === 401) return handleAccessLost();
  if (!response || response.status >= 500) {
    // Unknown outcome: read the actual state and history; never repeat the write automatically.
    view.actionMessage = {
      kind: 'uncertain',
      text: "We couldn't confirm whether this change was saved. The current order is being checked — review its status and history before choosing another action.",
    };
    renderDetail();
    coordinator.refresh();
    return;
  }
  if (response.status === 200) {
    if (target === 'Cancelled') {
      clearDraft();
      ws.reason.value = '';
    }
    view.actionMessage = { kind: 'success', text: `Order ${number} is now ${data.order.status}.` };
    applyDetail(data.order, new Date());
  } else if (response.status === 409) {
    // showConflict: current state from the server, explanation, and a fresh deliberate choice required.
    view.actionMessage = { kind: 'conflict', text: data.message };
    applyDetail(data.order, new Date());
  } else if (response.status === 422) {
    view.actionMessage = { kind: 'error', text: data.message };
    if (data.order) applyDetail(data.order, new Date());
    if (data.error === 'reason_required' || data.error === 'reason_too_long') {
      view.reasonError = data.message;
      renderReasonError();
    }
  } else if (response.status === 404) {
    view.detailUnavailable = true;
    view.detail = null;
  } else {
    view.actionMessage = { kind: 'error', text: data?.message ?? 'This change was not accepted.' };
  }
  renderDetail();
}

// ---------- startup ----------

elements.signInForm.addEventListener('submit', signIn);
elements.dialogKeep.addEventListener('click', dismissCancel);
elements.dialogConfirm.addEventListener('click', confirmCancel);
elements.dialog.addEventListener('close', dismissCancel);
window.addEventListener('hashchange', route);

async function checkSession() {
  let response = null;
  try {
    response = await requestJson('/api/staff/session', { timeoutMs: 8000 });
  } catch {
    response = null;
  }
  if (response?.status === 200) {
    view.employee = response.data.employee;
    view.restoreDraftAfterSignIn = true;
    return enterWorkspace();
  }
  if (response?.status === 401) return showSignIn(null);
  replaceContent(
    elements.sessionCheck,
    h(
      'div',
      { class: 'warning', role: 'alert' },
      h('p', {}, "We couldn't reach Mesa Tica to check your staff session. Check your connection and try again."),
      h('button', { type: 'button', class: 'button secondary', onclick: checkSession }, 'Try again'),
    ),
  );
}

if (!location.hash) history.replaceState(null, '', queueHref('Active'));
checkSession();
