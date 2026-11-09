// CustomerView: menu, cart, submission recovery and confirmation.

import { api, createStore, html, money, orderLines, patch, randomId } from '/assets/shared.js';

const local = createStore('localStorage');
const session = createStore('sessionStorage');
const CART_KEY = 'mesa.cart.v1';
const PENDING_KEY = 'mesa.pending.v1';
const CONTEXT_KEY = 'mesa.context.v1';
const CONFIRMATION_KEY = 'mesa.confirmation.v1';

const MAX_QUANTITY = 999;
const MENU_REFRESH_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 15_000;
const WHOLE_NUMBER_ERROR = 'Enter a whole number greater than zero.';

const header = document.getElementById('site-header');
const view = document.getElementById('view');
const bar = document.getElementById('cart-bar');
const announcer = document.getElementById('announcer');

const loadCart = () => {
  const stored = local.get(CART_KEY, []);
  return Array.isArray(stored)
    ? stored.filter((r) => typeof r?.id === 'string' && Number.isInteger(r.quantity) && Number.isInteger(r.price))
    : [];
};

let menu = null;
let menuFailed = false;
let cart = loadCart();
let pending = local.get(PENDING_KEY, null); // the attempt bound to its reviewed selection, kept until its outcome is known
let phase = pending ? 'uncertain' : 'idle'; // idle | submitting | checking | uncertain | retryable
let attemptHint = null;
let cartNote = null;
let drafts = {}; // text of invalid quantity edits, by item id
let confirmation = session.get(CONFIRMATION_KEY, null);
let copyState = 'idle';

const saveCart = () => local.set(CART_KEY, cart);
const route = () => {
  if (location.hash.startsWith('#/cart')) return 'cart';
  return location.hash.startsWith('#/confirmation') ? 'confirmation' : 'menu';
};
const cartTotal = () => cart.reduce((sum, row) => sum + row.price * row.quantity, 0);
const cartCount = () => cart.reduce((sum, row) => sum + row.quantity, 0);
const items = (n) => `${n} item${n === 1 ? '' : 's'}`;

function customerContext() {
  let id = local.get(CONTEXT_KEY, null);
  if (!id) local.set(CONTEXT_KEY, id = randomId());
  return id;
}

function closedMessage() {
  if (!menu || menu.open) return null;
  const { contact, contactLabel } = menu.restaurant;
  return menu.nextOpening
    ? `Ordering is closed. Opens ${menu.nextOpening}.`
    : `The restaurant is currently closed. Contact ${contact} (${contactLabel})`;
}

function quantityProblem(text) {
  if (!/^\d+$/.test(text) || Number(text) < 1) return WHOLE_NUMBER_ERROR;
  return Number(text) > MAX_QUANTITY ? `Enter a whole number from 1 to ${MAX_QUANTITY}.` : null;
}

/** Why the order cannot be placed right now, or null when it can. */
function submitBlock() {
  if (pending) return 'Check your earlier order attempt before placing another.';
  return closedMessage()
    ?? (Object.keys(drafts).length ? 'Correct the quantity above to continue.' : null)
    ?? (cart.some((row) => row.unavailable) ? 'Remove unavailable items to continue.' : null);
}

/* ---------- Cart corrections ---------- */

const priceNotice = (name, price) => `${name} is now ${money(price)}. Review your updated total before placing the order.`;
const unavailableNotice = (name) => `${name} is no longer available. Remove it or choose another item.`;

function applyCorrection(correction) {
  const row = cart.find((r) => r.id === correction.itemId);
  if (!row) return;
  if (correction.type === 'price_changed') {
    row.price = correction.price;
    row.notice = priceNotice(row.name, correction.price);
  } else if (correction.type === 'unavailable') {
    row.unavailable = true;
    row.notice = unavailableNotice(row.name);
  } else if (correction.type === 'invalid_quantity') {
    row.notice = WHOLE_NUMBER_ERROR;
  }
}

/** Compares the cart with the current menu when the customer opens or reopens it. */
function reconcileCart() {
  if (!menu || pending) return;
  const current = new Map(menu.groups.flatMap((g) => g.items).map((item) => [item.id, item]));
  for (const row of cart) {
    const item = current.get(row.id);
    if (!item?.available) {
      if (!row.unavailable) applyCorrection({ type: 'unavailable', itemId: row.id });
      continue;
    }
    if (row.unavailable) {
      row.unavailable = false;
      row.notice = null;
    }
    if (item.price !== row.price) applyCorrection({ type: 'price_changed', itemId: row.id, price: item.price });
  }
  saveCart();
}

/* ---------- Rendering ---------- */

function renderHeader() {
  const cartLink = html`<a id="cart-link" class="cart-link" href="#/cart">Cart · ${items(cartCount())} · ${money(cartTotal())}</a>`;
  if (!menu) return patch(header, html`<div class="brand-row"><a class="brand" href="#/">Mesa Tica</a>${cartLink}</div>`);
  const r = menu.restaurant;
  patch(header, html`
    <div class="brand-row"><div><a class="brand" href="#/">${r.name}</a><span class="descriptor">${r.descriptor}</span></div>${cartLink}</div>
    <p class="state ${menu.open ? 'state-open' : 'state-closed'}">${menu.open ? 'Open now' : 'Closed'}</p>
    ${closedMessage() ? html`<p class="closed-message">${closedMessage()}</p>` : ''}
    ${menuFailed ? html`<p class="alert" role="alert">We couldn't refresh the menu. Prices and hours may be out of date.</p>` : ''}
    ${route() === 'menu' ? html`
    <dl class="facts">
      <div><dt>Hours</dt><dd>${r.hours} (restaurant time)</dd></div>
      <div><dt>Pickup</dt><dd>${r.pickupLocation}. Prices include taxes, with no extra fees.</dd></div>
      <div><dt>Please note</dt><dd>${r.customerNote}</dd></div>
      <div><dt>Contact</dt><dd>${r.contact} (${r.contactLabel})</dd></div>
    </dl>` : ''}`);
}

function renderBar() {
  if (route() !== 'menu' || !cart.length) return patch(bar, html``);
  patch(bar, html`<a id="cart-bar-link" class="cart-bar" href="#/cart"><span>${items(cartCount())} in your cart</span><strong>Review cart · ${money(cartTotal())}</strong></a>`);
}

function pendingPanel() {
  if (!pending) return '';
  if (phase === 'submitting') return html`<p class="progress" role="status">Placing your order…</p>`;
  if (phase === 'checking') return html`<p class="progress" role="status">Checking your order…</p>`;
  const lines = pending.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ');
  return html`
    <section class="alert" role="alert">
      <h2 class="panel-title">We couldn't confirm the result</h2>
      <p>We couldn't confirm the result. Check this order before placing another.</p>
      <p><strong>This attempt:</strong> ${lines} · ${money(pending.total)}</p>
      ${phase === 'retryable' ? html`<p>We found no confirmed order for this attempt yet. Retry safely sends this same order again and cannot create a second one.</p>` : ''}
      ${attemptHint ? html`<p>${attemptHint}</p>` : ''}
      <div class="actions">
        <button id="check-order" class="button" data-action="check">Check order</button>
        ${phase === 'retryable' ? html`<button id="retry-order" class="button button-quiet" data-action="retry">Retry safely</button>` : ''}
      </div>
    </section>`;
}

function menuView() {
  if (!menu) {
    if (!menuFailed) return html`<p class="muted" role="status">Loading the menu…</p>`;
    return html`<p class="alert" role="alert">We couldn't load the menu. Check your connection and try again.</p>
      <button id="reload-menu" class="button" data-action="reload">Try again</button>`;
  }
  if (!menu.groups.length) {
    const r = menu.restaurant;
    return html`${pendingPanel()}<p class="alert" role="status">Ordering is unavailable right now because the menu has no dishes. Contact ${r.contact} (${r.contactLabel})</p>`;
  }
  return html`
    ${pendingPanel()}
    <h1 class="sr-only">Menu</h1>
    ${menu.groups.map((group) => html`
    <section><h2>${group.name}</h2>
      <ul class="dishes">${group.items.map((item) => html`
        <li class="dish ${item.available ? '' : 'dish-out'}">
          <div><h3>${item.name}</h3><p>${item.description}</p>
            ${item.available ? '' : html`<p class="out-note">This dish can't be ordered right now.</p>`}</div>
          <div class="dish-side">
            <span class="price">${money(item.price)}</span>
            ${item.available
              ? html`<button id="add-${item.id}" class="button" data-action="add" data-id="${item.id}" aria-label="Add ${item.name}" ${pending ? 'disabled' : ''}>Add</button>`
              : html`<span class="tag">Unavailable</span>`}
          </div>
        </li>`)}</ul>
    </section>`)}`;
}

const subtotalText = (row) => `Subtotal ${money(row.price * row.quantity)}`;

function rowError(row) {
  return row.id in drafts ? quantityProblem(drafts[row.id].trim()) : null;
}

function cartView() {
  if (!cart.length) {
    return html`${pendingPanel()}<h1>Your cart</h1>
      ${cartNote ? html`<p class="alert" role="alert">${cartNote}</p>` : ''}
      <p>Your cart is empty</p>
      <a id="back-to-menu" class="button" href="#/">Back to the menu</a>`;
  }
  const locked = pending || phase !== 'idle';
  return html`
    ${pendingPanel()}
    <h1>Your cart</h1>
    ${cartNote ? html`<p class="alert" role="alert">${cartNote}</p>` : ''}
    <ul class="cart-rows">${cart.map((row) => html`
      <li class="cart-row">
        <div class="cart-row-head">
          <div><h3>${row.name}</h3><p class="muted">${money(row.price)} each</p></div>
          <p id="sub-${row.id}" class="line-total">${subtotalText(row)}</p>
        </div>
        ${row.notice ? html`<p class="notice" role="status">${row.notice}</p>` : ''}
        <div class="cart-row-controls">
          <label for="qty-${row.id}">Quantity</label>
          <button id="dec-${row.id}" class="step" data-action="step" data-id="${row.id}" data-by="-1" aria-label="Decrease quantity of ${row.name}" ${locked || row.unavailable || row.quantity <= 1 ? 'disabled' : ''}>−</button>
          <input id="qty-${row.id}" class="qty" data-id="${row.id}" inputmode="numeric" autocomplete="off"
            value="${row.id in drafts ? drafts[row.id] : row.quantity}" aria-describedby="err-${row.id}"
            ${rowError(row) ? html`aria-invalid="true"` : ''} ${locked || row.unavailable ? 'disabled' : ''}>
          <button id="inc-${row.id}" class="step" data-action="step" data-id="${row.id}" data-by="1" aria-label="Increase quantity of ${row.name}" ${locked || row.unavailable || row.quantity >= MAX_QUANTITY ? 'disabled' : ''}>+</button>
          <button id="remove-${row.id}" class="link-button" data-action="remove" data-id="${row.id}" aria-label="Remove ${row.name}" ${locked ? 'disabled' : ''}>Remove</button>
        </div>
        <p id="err-${row.id}" class="field-error">${rowError(row)}</p>
      </li>`)}</ul>
    <div id="cart-summary"></div>`;
}

function renderSummary() {
  const el = document.getElementById('cart-summary');
  if (!el) return;
  const block = submitBlock();
  const busy = phase === 'submitting' || phase === 'checking';
  patch(el, html`
    <div class="summary">
      <p class="summary-total"><span>Total</span><strong id="cart-total">${money(cartTotal())}</strong></p>
      <p class="muted">Pay at collection. Prices include taxes, with no extra fees. This cart is not a reservation; prices and availability are checked when you place the order.</p>
      <button id="place-order" class="button button-wide" data-action="place" ${block || busy ? 'disabled' : ''} aria-describedby="place-why">Place pickup order</button>
      <p id="place-why" class="place-why">${busy ? '' : block}</p>
    </div>`);
}

function renderConfirmation() {
  if (!confirmation) {
    return patch(view, html`<h1>No order to show</h1><p>This page only shows an order just placed in this tab. Saved tracking links still work.</p>
      <a id="back-to-menu" class="button" href="#/">Back to the menu</a>`);
  }
  const c = confirmation;
  const link = new URL(c.trackingPath, location.origin).href;
  patch(view, html`
    <h1 id="confirmation-heading" tabindex="-1">${c.status === 'Received' ? 'Order received' : 'We found your order'}</h1>
    <p class="order-number">Order number <strong>#${c.number}</strong></p>
    ${c.selectionMismatch ? html`<p class="alert" role="status">Your later cart changes were not ordered. This is your original order.</p>` : ''}
    <p class="status-line"><span class="status-pill">${c.status}</span> ${c.guidance.message}</p>
    ${c.status === 'Cancelled' ? html`<p>Open the order's progress page to see the reason and restaurant contact.</p>` : ''}
    ${orderLines(c.items, c.total)}
    <p class="muted">Placed ${c.submitted} (restaurant time)</p>
    ${c.paymentInstructions ? html`<p class="callout"><strong>Pay at collection.</strong> ${c.paymentInstructions}</p>` : ''}
    <div class="actions">
      <a id="view-progress" class="button" href="${c.trackingPath}">View progress</a>
      <button id="copy-link" class="button button-quiet" data-action="copy">Copy tracking link</button>
    </div>
    <p id="copy-status" class="copy-status" role="status">${copyState === 'copied' ? 'Link copied' : ''}</p>
    ${copyState === 'failed' ? html`
      <div class="copy-fallback">
        <label for="manual-link">We couldn't copy automatically. Select this link and copy it yourself:</label>
        <input id="manual-link" readonly value="${link}">
      </div>` : ''}
    <p>Save this link or bookmark the tracking page so you can check your order later. Anyone with this link can view this order.</p>
    <p class="muted">You can't change or cancel this order here. Changes and cancellations are handled by restaurant staff.</p>
    <button id="new-order" class="button button-quiet" data-action="new">Start a new order</button>`);
}

function render() {
  renderHeader();
  renderBar();
  const page = route();
  if (page === 'menu') patch(view, menuView());
  else if (page === 'cart') {
    patch(view, cartView());
    renderSummary();
  } else renderConfirmation();
}

/** Background refresh: must never rebuild quantity inputs. */
function renderLive() {
  renderHeader();
  renderBar();
  if (route() === 'menu') patch(view, menuView());
  else if (route() === 'cart') renderSummary();
}

/* ---------- Submission and recovery ---------- */

function clearPending() {
  pending = null;
  local.remove(PENDING_KEY);
  phase = 'idle';
  attemptHint = null;
}

function showConfirmation(result) {
  confirmation = result;
  session.set(CONFIRMATION_KEY, result);
  copyState = 'idle';
  cart = [];
  drafts = {};
  cartNote = null;
  saveCart();
  clearPending();
  location.hash = '#/confirmation';
  render();
  document.getElementById('confirmation-heading')?.focus();
}

function applyRejection(result) {
  clearPending();
  result.corrections.forEach(applyCorrection);
  saveCart();
  if (menu) Object.assign(menu, { open: result.open, nextOpening: result.nextOpening });
  const parts = ['Your order was not placed.'];
  if (result.closed) parts.push(result.open ? 'Ordering was closed at that time. You can place it again now.' : closedMessage());
  if (result.corrections.length) parts.push('Review the changes below, then place your order again.');
  cartNote = parts.join(' ');
  location.hash = '#/cart';
  render();
  refreshMenu();
}

function applyResult(result, failureHint) {
  if (result.status === 200 && result.data.outcome === 'accepted') return showConfirmation(result.data);
  if (result.status === 422 && result.data.outcome === 'rejected') return applyRejection(result.data);
  if (result.status === 200 && result.data.outcome === 'unresolved') {
    phase = 'retryable';
    attemptHint = null;
  } else {
    phase = 'uncertain';
    attemptHint = failureHint;
  }
  render();
}

async function submitPending(failureHint) {
  phase = 'submitting';
  cartNote = null;
  render();
  const result = await api('/api/orders', {
    method: 'POST',
    body: { context: customerContext(), attempt: pending.attempt, selection: pending.selection },
    timeoutMs: SUBMIT_TIMEOUT_MS,
  });
  applyResult(result, failureHint);
}

function placeOrder() {
  if (phase !== 'idle' || !cart.length || submitBlock()) return;
  pending = {
    attempt: randomId(),
    selection: cart.map((row) => ({ itemId: row.id, quantity: row.quantity, reviewedPrice: row.price })),
    lines: cart.map((row) => ({ name: row.name, quantity: row.quantity })),
    total: cartTotal(),
  };
  local.set(PENDING_KEY, pending); // saved before sending, so a lost response stays recoverable
  submitPending(null);
}

async function checkOrder() {
  if (!pending || phase === 'submitting' || phase === 'checking') return;
  phase = 'checking';
  render();
  const result = await api('/api/orders/recover', {
    method: 'POST',
    body: { context: customerContext(), attempt: pending.attempt },
    timeoutMs: SUBMIT_TIMEOUT_MS,
  });
  applyResult(result, "We still couldn't reach the restaurant. Try again in a moment.");
}

/* ---------- Actions ---------- */

function addItem(id) {
  const item = menu?.groups.flatMap((g) => g.items).find((i) => i.id === id);
  if (!item?.available || pending) return;
  const row = cart.find((r) => r.id === id);
  if (row && row.quantity >= MAX_QUANTITY) return;
  if (row) row.quantity += 1;
  else cart.push({ id: item.id, name: item.name, price: item.price, quantity: 1 });
  saveCart();
  announcer.textContent = `${item.name} added. Cart total ${money(cartTotal())}.`;
  render();
}

function stepQuantity(id, by) {
  const row = cart.find((r) => r.id === id);
  if (!row || pending) return;
  row.quantity = Math.min(MAX_QUANTITY, Math.max(1, row.quantity + by));
  delete drafts[id];
  saveCart();
  render();
}

function removeItem(id) {
  if (pending) return;
  cart = cart.filter((r) => r.id !== id);
  delete drafts[id];
  saveCart();
  render();
  (view.querySelector('.qty, a.button') ?? view).focus();
}

function onQuantityInput(input) {
  const { id } = input.dataset;
  const row = cart.find((r) => r.id === id);
  if (!row) return;
  const problem = quantityProblem(input.value.trim());
  if (problem) drafts[id] = input.value;
  else {
    delete drafts[id];
    row.quantity = Number(input.value.trim());
    saveCart();
  }
  // Update around the field only: rebuilding the input would disturb typing and mobile keyboards.
  if (problem) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  document.getElementById(`err-${id}`).textContent = problem ?? '';
  document.getElementById(`sub-${id}`).textContent = subtotalText(row);
  document.getElementById(`dec-${id}`).disabled = row.quantity <= 1;
  document.getElementById(`inc-${id}`).disabled = row.quantity >= MAX_QUANTITY;
  renderHeader();
  renderSummary();
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(new URL(confirmation.trackingPath, location.origin).href);
    copyState = 'copied';
  } catch {
    copyState = 'failed';
  }
  renderConfirmation();
  if (copyState === 'failed') document.getElementById('manual-link').select();
}

view.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, by } = button.dataset;
  if (action === 'add') addItem(id);
  else if (action === 'step') stepQuantity(id, Number(by));
  else if (action === 'remove') removeItem(id);
  else if (action === 'place') placeOrder();
  else if (action === 'check') checkOrder();
  else if (action === 'retry') submitPending('This attempt is still unconfirmed. Check it again before placing another order.');
  else if (action === 'copy') copyLink();
  else if (action === 'reload') refreshMenu();
  else if (action === 'new') {
    confirmation = null;
    session.remove(CONFIRMATION_KEY);
    location.hash = '#/';
  }
});

view.addEventListener('input', (event) => {
  if (event.target.matches('.qty')) onQuantityInput(event.target);
});

/* ---------- Menu refresh and navigation ---------- */

async function refreshMenu({ reconcile = false } = {}) {
  const result = await api('/api/menu');
  if (result.status === 200) {
    menu = result.data;
    menuFailed = false;
    if (reconcile) reconcileCart();
  } else {
    menuFailed = true;
  }
  if (reconcile) render();
  else renderLive();
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  if (route() === 'cart') refreshMenu({ reconcile: true });
});

window.addEventListener('storage', (event) => {
  if (event.key === CART_KEY) cart = loadCart();
  if (event.key === PENDING_KEY && phase !== 'submitting' && phase !== 'checking') {
    pending = local.get(PENDING_KEY, null);
    phase = pending ? 'uncertain' : 'idle';
  }
  render();
});

render();
refreshMenu({ reconcile: true });
setInterval(refreshMenu, MENU_REFRESH_MS);
