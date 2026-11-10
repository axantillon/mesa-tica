import { $, escape, time, announce, api, summary, readStorage, writeStorage, observe } from './shared.js';

const main = $('#main');
let observer;
let current;
let stale = true;
let busy = false;
let actionRevision;
let actionButton;
let checkedAt;
let lastActions = '';
let filter = readStorage('sessionStorage', 'mesa-filter', 'Active');
const allFilters = ['Active', 'Received', 'Preparing', 'Ready', 'Collected', 'Cancelled', 'All'];
if (!allFilters.includes(filter)) filter = 'Active';
const orderNumber = () => /^#order-\d+$/.test(location.hash) ? Number(location.hash.slice(7)) : null;
const reasonKey = number => `mesa-reason-${number}`;
function accessLost(message) {
  observer?.stop();
  current = null;
  checkedAt = null;
  actionRevision = null;
  busy = false;
  $('#sign-out').hidden = true;
  main.innerHTML = `<section class="panel login"><p class="eyebrow">Restaurant workspace</p><h1>Staff sign in</h1><p>Authorized Mesa Tica employees only.</p><p id="login-error" class="notice" role="alert" ${message ? '' : 'hidden'}>${escape(message)}</p><form id="login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="100"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><div class="actions"><button type="submit">Sign in</button></div></form></section>`;
  $('#login').onsubmit = async event => {
    event.preventDefault();
    const button = $('button', event.target);
    button.disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
      await route();
    } catch (error) {
      $('#login-error').hidden = false;
      $('#login-error').textContent = [400, 401, 429].includes(error.status) ? error.message : 'Could not reach sign-in. Check your connection and try again.';
      button.disabled = false;
    }
  };
}
function freshness(message, failed = false) {
  const element = $('#freshness');
  if (!element) return;
  element.className = failed ? 'notice' : 'muted';
  element.textContent = message;
}
function updateActions() {
  if (!current) return;
  const signature = `${current.status}:${stale}:${busy}`;
  if (signature === lastActions) return;
  lastActions = signature;
  $('#lifecycle').innerHTML = current.actions.filter(action => action !== 'Cancelled').map(action => `<button data-target="${action}" ${stale || busy ? 'disabled' : ''}>Mark ${action}</button>`).join('');
  $('#cancel-section').hidden = !current.actions.includes('Cancelled');
  $('#cancel-order').disabled = stale || busy;
}
function showDetail(result) {
  current = result.order;
  stale = false;
  checkedAt = result.checkedAt;
  $('#detail-summary').innerHTML = summary(current);
  $('#history').innerHTML = current.history.length ? `<ol class="history">${current.history.map(change => `<li><strong>${escape(change.from)} → ${escape(change.to)}</strong><br>${escape(change.employee)} · ${time(change.time)}${change.reason ? `<p>${escape(change.reason)}</p>` : ''}</li>`).join('')}</ol>` : '<p class="muted">No staff changes yet.</p>';
  if (current.reason) $('#cancelled-reason').textContent = `Cancellation reason: ${current.reason}`;
  freshness(`Last checked ${time(checkedAt)} · Automatic updates`);
  updateActions();
}
function failedRead(error) {
  if (error.status === 401 || error.status === 403) return accessLost(error.message);
  stale = true;
  freshness(error.status === 404 ? error.message : `Updates are unavailable. ${checkedAt ? `This information may be out of date. Last checked ${time(checkedAt)}.` : 'No current information has loaded.'} Refresh before acting.`, true);
  updateActions();
}
function queue() {
  main.innerHTML = `<div class="row"><div><p class="eyebrow">Restaurant workspace</p><h1>Order queue</h1></div><div><label for="filter">Show orders</label><select id="filter">${allFilters.map(value => `<option ${value === filter ? 'selected' : ''}>${value}</option>`).join('')}</select></div></div><p>Oldest orders first · Payment happens at the counter.</p><div id="freshness" role="status">Loading orders…</div><section id="queue" aria-label="Orders"></section>`;
  $('#filter').onchange = event => {
    filter = event.target.value;
    writeStorage('sessionStorage', 'mesa-filter', filter);
    observer?.stop();
    checkedAt = null;
    queue();
  };
  observer = observe(() => api(`/api/staff/orders?filter=${encodeURIComponent(filter)}`), result => {
    checkedAt = result.checkedAt;
    freshness(`Last checked ${time(checkedAt)} · Automatic updates`);
    const markup = result.orders.length ? result.orders.map(order => `<a class="queue-item" href="#order-${order.number}"><div class="row"><strong>Order #${order.number}</strong><span class="status">${escape(order.status)}</span></div><p>${order.items.map(item => `${item.quantity} × ${escape(item.name)}`).join(', ')}</p><small>${time(order.submittedAt)}</small></a>`).join('') : `<p class="panel">${filter === 'Active' ? 'No active orders.' : 'No orders match this filter.'}</p>`;
    // Do not replace unchanged controls during automatic reads.
    if ($('#queue').innerHTML !== markup) $('#queue').innerHTML = markup;
  }, failedRead);
}
function detail(number) {
  current = null;
  stale = true;
  lastActions = '';
  main.innerHTML = `<section class="summary"><a href="#queue">← Back to queue</a><h1>Order detail</h1><div id="freshness" role="status">Loading order…</div><p id="action-message" role="alert"></p><div id="detail-summary" class="panel"></div><p id="cancelled-reason"></p><div class="actions" id="lifecycle"></div><section class="panel" id="cancel-section" hidden><h2>Cannot fulfill this order?</h2><label for="reason">Customer-visible cancellation reason</label><textarea id="reason" maxlength="1000" placeholder="Explain why the order cannot be fulfilled."></textarea><small>The customer will see this reason. Do not include private personal information.</small><p id="reason-error" class="error" role="alert"></p><div class="actions"><button id="cancel-order" class="secondary">Cancel order</button></div><p id="draft-warning" class="notice" hidden>Browser saving is unavailable. This draft cannot survive leaving or signing in again.</p></section><section class="panel"><h2>Status history</h2><div id="history"></div></section><dialog aria-labelledby="cancel-title" aria-describedby="cancel-description"><h2 id="cancel-title">Cancel order #${number}?</h2><p id="cancel-description">The customer will see this reason.</p><blockquote id="confirm-reason"></blockquote><div class="actions"><button id="dismiss-cancel" class="secondary" autofocus>Keep order</button><button id="confirm-cancel" class="danger">Confirm cancellation</button></div></dialog></section>`;
  $('#reason').value = readStorage('sessionStorage', reasonKey(number), '');
  $('#reason').oninput = () => {
    $('#draft-warning').hidden = writeStorage('sessionStorage', reasonKey(number), $('#reason').value);
    $('#reason-error').textContent = '';
  };
  $('#lifecycle').onclick = event => {
    const button = event.target.closest('[data-target]');
    if (!button || stale || busy || !current) return;
    const revision = current.revision;
    change(number, revision, button.dataset.target, '');
  };
  $('#cancel-order').onclick = () => {
    if (stale || busy || !current) return;
    if (!$('#reason').value.trim()) {
      $('#reason-error').textContent = 'Enter a nonblank reason before cancelling.';
      $('#reason').focus(); return;
    }
    actionRevision = current.revision;
    actionButton = $('#cancel-order');
    $('#confirm-reason').textContent = $('#reason').value;
    $('dialog').showModal();
  };
  const dismiss = () => { $('dialog').close(); actionRevision = null; actionButton?.focus(); };
  $('#dismiss-cancel').onclick = dismiss;
  $('dialog').addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  $('#confirm-cancel').onclick = () => {
    const revision = actionRevision;
    const reason = $('#reason').value;
    $('dialog').close();
    change(number, revision, 'Cancelled', reason);
  };
  observer = observe(() => api(`/api/staff/orders/${number}`), showDetail, failedRead);
}
async function change(number, revision, target, reason) {
  if (busy || stale) return;
  busy = true;
  updateActions();
  $('#action-message').textContent = 'Saving change…';
  // Stop reads so an older response cannot replace the accepted write result.
  observer?.stop();
  try {
    const result = await api(`/api/staff/orders/${number}`, { method: 'POST', body: JSON.stringify({ revision, target, reason }) });
    busy = false;
    showDetail(result);
    $('#action-message').textContent = `Saved: ${result.order.status}.`;
    announce(`Order ${number}: ${result.order.status}.`);
  } catch (error) {
    busy = false;
    if ([401, 403].includes(error.status)) return accessLost(error.message);
    stale = true;
    $('#action-message').textContent = error.status === 409 ? error.message : error.status === 422 ? error.message : 'The change could not be confirmed. Checking actual state and history; review before choosing another action.';
    updateActions();
  }
  observer = observe(() => api(`/api/staff/orders/${number}`), showDetail, failedRead);
}
async function route() {
  observer?.stop();
  current = null;
  checkedAt = null;
  try {
    await api('/api/staff/session');
    $('#sign-out').hidden = false;
    const number = orderNumber();
    number ? detail(number) : queue();
  } catch (error) { accessLost(error.status === 401 ? '' : 'Staff access could not be checked. Check your connection and sign in again.'); }
}
$('#sign-out').onclick = async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
    location.hash = 'queue';
    accessLost('Signed out.');
  } catch { announce('Sign-out is not confirmed. Try again.'); }
};
window.addEventListener('hashchange', route);
window.addEventListener('pageshow', event => { if (event.persisted) route(); });
route();
