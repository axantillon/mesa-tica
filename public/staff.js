import { $, badge, escape, itemSummary, localTime, orderNumber, request } from './common.js';
import { observe } from './updates.js';

const parameters = new URLSearchParams(location.search);
const number = parameters.get('order');
const viewingOrder = number !== null;
const validOrderNumber = /^[1-9]\d{0,14}$/.test(number ?? '');
const filter = $('#filter');
if ([...filter.options].some((option) => option.value === parameters.get('filter'))) {
  filter.value = parameters.get('filter');
}

const content = $('#staff-content');
const warning = $('#staff-warning');
const checked = $('#staff-checked');
const feedback = $('#staff-feedback');
const dialog = $('#cancel-dialog');
const reasonInput = $('#cancel-reason');

let stop;
let detail;
let lastChecked;
let stale = false;
let action;
let writing = false;
let draftReason = '';
let rendered = '';
let signedIn = false;
let sessionGeneration = 0;

const queueLink = () => '/staff?' + new URLSearchParams({ filter: filter.value });

function showText(node, text) {
  if (node.textContent !== text) node.textContent = text;
  node.hidden = !text;
}

function showSignIn(note, focus = false) {
  stop?.();
  signedIn = false;
  sessionGeneration++;
  action = null;
  if (dialog.open) dialog.close();
  detail = null;
  lastChecked = null;
  rendered = '';
  content.replaceChildren();
  $('#workspace').hidden = true;
  $('#session-loading').hidden = true;
  $('#sign-in').hidden = false;
  showText($('#sign-in-note'), note);
  if (focus) $('#sign-in-heading').focus();
}

function showWorkspace(employee) {
  signedIn = true;
  $('#sign-in').hidden = true;
  $('#session-loading').hidden = true;
  $('#workspace').hidden = false;
  $('#employee').textContent = employee.name;
  $('#workspace-heading').textContent = viewingOrder && validOrderNumber ? 'Order ' + orderNumber(number) : viewingOrder ? 'Order detail' : 'Pickup queue';
  $('#queue-tools').hidden = viewingOrder;
  $('#back-queue').hidden = !viewingOrder;
  $('#back-queue').href = queueLink();
  showText(feedback, '');
  startRefresh({ reset: true });
}

function renderQueue({ orders, timezone }) {
  if (!orders.length) {
    content.innerHTML = `<p class="panel">${filter.value === 'Active' ? 'No active orders.' : 'No orders match this filter.'}</p>`;
    return;
  }
  content.innerHTML = `<ul class="queue-list">${orders.map((order) => `
    <li><a class="queue-card" data-order="${order.number}" href="${escape(queueLink() + '&order=' + order.number)}">
      <span class="queue-title"><strong>Order ${orderNumber(order.number)}</strong> ${badge(order.status)}</span>
      <span>${order.items.map((item) => escape(item.quantity + ' × ' + item.name)).join(' · ')}</span>
      <small>${localTime(order.submittedAt, timezone, true)} · Costa Rica time</small>
    </a></li>`).join('')}</ul>`;
}

const actionName = (target) => target === 'Cancelled' ? 'Cancel order' : 'Mark ' + target;

function renderDetail({ order, history, actions, timezone }) {
  content.innerHTML = `<div class="detail-grid">
    <section class="panel" aria-labelledby="accepted-heading">
      <h2 id="accepted-heading">Accepted items</h2>
      <p class="small">Submitted ${localTime(order.submittedAt, timezone, true)} · Costa Rica time</p>
      ${itemSummary(order)}
    </section>
    <section class="panel" aria-labelledby="progress-heading">
      <h2 id="progress-heading">Progress</h2>
      <div role="status">${badge(order.status)}</div>
      ${order.status === 'Cancelled' ? `<p><strong>Cancellation reason:</strong> <span class="reason">${escape(order.reason)}</span></p>` : ''}
      <div class="actions" id="status-actions">${actions.map((target) => `
        <button type="button" class="button ${target === 'Cancelled' ? 'quiet' : ''}" data-target="${target}">${actionName(target)}</button>
      `).join('')}</div>
      <h3>Staff status history</h3>
      ${history.length ? `<ol class="history">${history.map((change) => `
        <li><strong>${escape(change.previous)} → ${escape(change.status)}</strong><br>
          <small>${escape(change.employee)} · ${localTime(change.changedAt, timezone, true)}</small>
        </li>`).join('')}</ol>` : '<p class="small">No staff changes yet.</p>'}
    </section>
  </div>`;
}

function syncControls() {
  for (const button of content.querySelectorAll('[data-target]')) {
    button.disabled = stale || writing || Boolean(action);
  }
  $('#confirm-cancel').disabled = stale || writing;
  if (dialog.open) {
    showText($('#dialog-warning'), stale ? 'This order may be out of date. Wait for a successful refresh.' : '');
  }
}

function display(data, at) {
  if (viewingOrder) detail = data;
  const key = JSON.stringify(viewingOrder ? data.order.revision : data.orders);
  if (rendered !== key) {
    const focused = content.contains(document.activeElement) ? document.activeElement : null;
    const previousOrder = focused?.dataset.order;
    const previousTarget = focused?.dataset.target;
    if (viewingOrder) renderDetail(data);
    else renderQueue(data);
    rendered = key;
    if (focused) {
      const replacement = [...content.querySelectorAll('[data-order], [data-target]')].find((node) =>
        previousOrder ? node.dataset.order === previousOrder : node.dataset.target === previousTarget);
      (replacement ?? $('#workspace-heading')).focus();
    }
  }
  stale = false;
  lastChecked = at;
  showText(warning, '');
  showText(checked, 'Last refreshed ' + localTime(lastChecked, data.timezone) + ' · Costa Rica time');
  syncControls();
}

function unavailable(error) {
  if (error.status === 401) {
    showSignIn('Staff access expired. Sign in to view or change orders.', true);
    return false;
  }
  if (error.status === 404) {
    showText(warning, 'This order is unavailable. Return to the queue to choose an order.');
    content.replaceChildren();
    showText(checked, '');
    detail = null;
    action = null;
    if (dialog.open) dialog.close();
    return false;
  }
  stale = true;
  if (!lastChecked) content.replaceChildren();
  showText(warning, lastChecked ? 'Updates are unavailable. This information may be out of date.'
    : 'Orders could not load. Retrying…');
  syncControls();
}

function startRefresh({ reset = false } = {}) {
  stop?.();
  if (reset) {
    lastChecked = null;
    detail = null;
    stale = false;
    rendered = '';
    showText(checked, '');
    showText(warning, '');
    content.innerHTML = '<p role="status">Loading orders…</p>';
  }
  if (!signedIn) return;
  if (viewingOrder && !validOrderNumber) return unavailable({ status: 404 });
  const path = viewingOrder ? '/api/staff/orders/' + number
    : '/api/staff/orders?filter=' + encodeURIComponent(filter.value);
  stop = observe(path, { success: display, failure: unavailable });
}

function report(text) {
  showText(feedback, text);
  if (text) feedback.focus();
}

async function writeChange(chosen) {
  if (stale || writing || !signedIn) return;
  writing = true;
  const generation = sessionGeneration;
  stop?.();
  if (dialog.open) dialog.close();
  syncControls();
  showText(feedback, 'Saving change…');
  try {
    const data = await request('/api/staff/orders/' + number, chosen);
    if (generation !== sessionGeneration) return;
    action = null;
    if (chosen.target === 'Cancelled') draftReason = '';
    display(data, new Date());
    report('Order marked ' + data.order.status + '.');
  } catch (error) {
    if (generation !== sessionGeneration) return;
    action = null;
    if (error.status === 409) {
      display(error.result, new Date());
      report('This order changed to ' + error.result.order.status + '. Review it before choosing another action.');
    } else if (error.status === 401 || error.status === 404) {
      unavailable(error);
    } else if (error.status === 422 || error.status === 400) {
      report('The change was rejected. Review the current order before trying again.');
    } else {
      stale = true;
      showText(warning, 'Updating order information. The last status may be out of date.');
      report("We couldn't confirm the change. Review the refreshed status and history before choosing another action.");
    }
  } finally {
    writing = false;
    if (generation === sessionGeneration) {
      syncControls();
      startRefresh();
    }
  }
}

content.addEventListener('click', ({ target }) => {
  const next = target.closest('[data-target]')?.dataset.target;
  if (!next || stale || writing || action || !detail?.actions.includes(next)) return;
  action = { revision: detail.order.revision, target: next };
  if (next === 'Cancelled') {
    $('#cancel-heading').textContent = 'Cancel order ' + orderNumber(number) + '?';
    reasonInput.value = draftReason;
    reasonInput.setCustomValidity('');
    dialog.showModal();
    reasonInput.focus();
    syncControls();
  } else {
    void writeChange(action);
  }
});

reasonInput.addEventListener('input', () => {
  draftReason = reasonInput.value;
  reasonInput.setCustomValidity('');
});

$('#keep-order').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  if (writing) return;
  action = null;
  syncControls();
  const button = content.querySelector('[data-target="Cancelled"]');
  if (button && !button.disabled) button.focus();
});

$('#cancel-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!action || stale || writing) return;
  if (!reasonInput.value.trim()) {
    reasonInput.setCustomValidity('Enter a cancellation reason.');
    reasonInput.reportValidity();
    return;
  }
  void writeChange({ ...action, reason: reasonInput.value, confirmed: true });
});

filter.addEventListener('change', () => {
  history.replaceState(null, '', queueLink());
  startRefresh({ reset: true });
});

$('#sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button', form);
  const body = Object.fromEntries(new FormData(form));
  button.disabled = true;
  showText($('#sign-in-note'), 'Signing in…');
  try {
    const employee = await request('/api/staff/sign-in', body);
    form.reset();
    showWorkspace(employee);
    $('#workspace-heading').focus();
  } catch (error) {
    showText($('#sign-in-note'), error.status === 401 ? "We couldn't sign you in. Check your credentials and try again."
      : error.status === 429 ? 'Too many sign-in attempts. Try again in a minute.'
        : "Couldn't reach sign-in. Check your connection and try again.");
  } finally {
    button.disabled = false;
  }
});

$('#sign-out').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  showText(feedback, 'Signing out…');
  try {
    await request('/api/staff/sign-out', {});
    draftReason = '';
    showSignIn('Signed out.', true);
  } catch {
    report("Couldn't confirm sign-out. Try signing out again.");
  } finally {
    button.disabled = false;
  }
});

try {
  showWorkspace(await request('/api/staff/session'));
} catch (error) {
  showSignIn(error.status === 401 ? '' : "Couldn't check staff access. Try signing in again.");
}
