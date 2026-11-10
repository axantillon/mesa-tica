/**
 * CustomerView: menu, cart, reviewed submission, uncertain-outcome recovery and confirmation.
 *
 * Browser storage: the cart, customer context and pending attempt live in localStorage (same browser);
 * the accepted confirmation lives in sessionStorage (same tab). A known acceptance is saved before the
 * pending attempt is discarded, so a reload at any moment still leads back to the order.
 */
import {
  addItem,
  applyCorrection,
  calculateTotal,
  changeQuantity,
  clearNotices,
  clearPurchased,
  parseQuantity,
  reconcileWithMenu,
  removeItem,
  toSelection,
} from './cart.js';
import { formatCRC, formatCheckTime, h, randomId, replaceContent, requestJson, safeStorage, statusBadge } from './common.js';

const local = safeStorage('localStorage');
const tab = safeStorage('sessionStorage');
const KEYS = {
  cart: 'mesa.cart',
  context: 'mesa.customerContext',
  pending: 'mesa.pendingAttempt',
  confirmation: 'mesa.confirmation',
};
const SUBMIT_TIMEOUT_MS = 15000;

const customerContext =
  local.get(KEYS.context) ??
  (() => {
    const created = randomId();
    local.set(KEYS.context, created);
    return created;
  })();

const state = {
  menu: null,
  menuFailed: false,
  cart: local.get(KEYS.cart) ?? [],
  quantityDrafts: {},
  pending: local.get(KEYS.pending),
  submitting: false,
  recovering: false,
  recoveryMessage: null,
  outcome: null,
  saved: tab.get(KEYS.confirmation),
  confirmationStored: true,
  statusCheck: null,
  copyState: 'idle',
  announcement: '',
};

const elements = {
  restaurant: document.getElementById('restaurant-info'),
  notices: document.getElementById('customer-notices'),
  menuView: document.getElementById('menu-view'),
  menu: document.getElementById('menu-content'),
  cart: document.getElementById('cart-content'),
  cartBar: document.getElementById('cart-bar'),
  confirmation: document.getElementById('confirmation-view'),
};

// ---------- storage ----------

function saveCart() {
  local.set(KEYS.cart, state.cart);
}

function savePending() {
  local.set(KEYS.pending, state.pending);
}

function clearPending() {
  state.pending = null;
  state.recoveryMessage = null;
  local.remove(KEYS.pending);
}

function retainConfirmation(result) {
  state.saved = { confirmation: result.confirmation, differentSelection: result.differentSelection };
  return tab.set(KEYS.confirmation, state.saved);
}

// ---------- derived state ----------

const menuItems = () => (state.menu ? state.menu.groups.flatMap((group) => group.items) : []);
const onConfirmationView = () => location.hash === '#confirmation' && state.saved !== null;
const trackingUrl = () => new URL(state.saved.confirmation.trackingPath, location.origin).href;

function submissionBlocker() {
  if (state.submitting) return 'Placing your order…';
  if (state.pending) return 'Check your previous order attempt before placing another order.';
  if (!state.menu) return state.menuFailed ? "The menu couldn't be loaded, so ordering is unavailable." : 'Loading the menu…';
  if (!state.menu.ordering.acceptingOrders) return state.menu.ordering.message;
  if (state.cart.length === 0) return 'Your cart is empty. Add a dish to place an order.';
  if (Object.keys(state.quantityDrafts).length > 0) return 'Fix the highlighted quantity before placing your order.';
  if (state.cart.some((item) => item.unavailable)) return 'Remove unavailable items before placing your order.';
  return null;
}

// ---------- actions ----------

function announce(text) {
  state.announcement = text;
}

function addToCart(menuItem) {
  const result = addItem(state.cart, menuItem);
  state.cart = result.items;
  saveCart();
  announce(result.added ? `Added ${menuItem.name}. Cart total ${formatCRC(calculateTotal(state.cart).total)}.` : result.message);
  render();
}

function editQuantity(code, text) {
  const parsed = parseQuantity(text);
  if (!parsed.ok) {
    state.quantityDrafts[code] = { text, message: parsed.message };
  } else {
    delete state.quantityDrafts[code];
    state.cart = changeQuantity(state.cart, code, parsed.value);
    saveCart();
  }
  render();
}

function removeFromCart(code) {
  const item = state.cart.find((entry) => entry.code === code);
  state.cart = removeItem(state.cart, code);
  delete state.quantityDrafts[code];
  saveCart();
  announce(`Removed ${item?.reviewedName ?? 'item'}.${state.cart.length === 0 ? ' Your cart is empty.' : ''}`);
  render();
  document.getElementById('cart')?.focus();
}

async function loadMenu() {
  try {
    const { status, data } = await requestJson('/api/menu');
    if (status !== 200) throw new Error('Menu unavailable');
    state.menu = data;
    state.menuFailed = false;
    state.cart = reconcileWithMenu(state.cart, menuItems());
    saveCart();
  } catch {
    state.menuFailed = true;
  }
  render();
}

/** reviewAndSubmit + beginAttempt + savePending: the attempt is bound to exactly the reviewed selection. */
async function placeOrder() {
  if (submissionBlocker()) return;
  const { lines, total } = calculateTotal(state.cart);
  state.cart = clearNotices(state.cart);
  saveCart();
  state.pending = {
    attempt: randomId(),
    selection: toSelection(state.cart),
    lines: lines.map(({ reviewedName, quantity, subtotal }) => ({ name: reviewedName, quantity, subtotal })),
    total,
  };
  savePending();
  await submitPending();
}

/** Sends the pending attempt (first try or "Retry safely"); always the original attempt and selection. */
async function submitPending() {
  state.submitting = true;
  state.outcome = { kind: 'progress', text: 'Placing your order…' };
  render();
  let response = null;
  try {
    response = await requestJson('/api/orders', {
      method: 'POST',
      body: { context: customerContext, attempt: state.pending.attempt, selection: state.pending.selection },
      timeoutMs: SUBMIT_TIMEOUT_MS,
    });
  } catch {
    response = null;
  }
  state.submitting = false;
  handleDecision(response, 'submit');
}

/** recoverPending ("Check order"): asks for the recorded outcome of the saved attempt. */
async function checkPending() {
  state.recovering = true;
  state.recoveryMessage = null;
  render();
  let response = null;
  try {
    response = await requestJson('/api/orders/recover', {
      method: 'POST',
      body: { context: customerContext, attempt: state.pending.attempt },
    });
  } catch {
    response = null;
  }
  state.recovering = false;
  handleDecision(response, 'check');
}

function handleDecision(response, source) {
  const data = response?.data;
  if (response && [200, 201].includes(response.status) && data?.outcome === 'accepted') return acceptKnown(data);
  if (response && (response.status === 422 || response.status === 200) && data?.outcome === 'rejected') {
    return rejectKnown(data.correction);
  }
  if (response && response.status === 400 && source === 'submit') {
    // Request validation happens before any business action, so this attempt cannot have been recorded.
    clearPending();
    state.outcome = { kind: 'error', text: `This order couldn't be sent: ${data?.message ?? 'invalid request.'} Your cart is unchanged.` };
    render();
    return;
  }
  state.outcome = null;
  state.recoveryMessage =
    source === 'check' && response?.status === 200 && data?.outcome === 'unresolved'
      ? "We couldn't find a confirmed result for this attempt yet. Retry safely to send the same order again; it can't create a second order."
      : source === 'check'
        ? "We couldn't reach Mesa Tica to check this order. Your attempt is saved. Try Check order again."
        : null;
  render();
  focusById('pending-heading');
}

/** Known acceptance: retain the confirmation first, then clear pending recovery data, then the purchased cart. */
function acceptKnown(result) {
  const selection = state.pending?.selection ?? [];
  state.confirmationStored = retainConfirmation(result);
  if (state.confirmationStored) {
    clearPending();
  } else {
    // Keep the stored pending attempt so a reload can still recover this order through Check order.
    state.pending = null;
  }
  state.cart = clearPurchased(state.cart, selection);
  state.quantityDrafts = {};
  saveCart();
  state.outcome = null;
  state.statusCheck = { state: 'fresh' };
  state.copyState = 'idle';
  if (location.hash !== '#confirmation') location.hash = 'confirmation';
  render();
  focusById('confirmation-heading');
}

/** Known rejection: the attempt is closed; keep the cart, apply the correction, require a fresh submit. */
function rejectKnown(correction) {
  clearPending();
  state.cart = applyCorrection(state.cart, correction);
  saveCart();
  if (correction.closed && state.menu) {
    state.menu.ordering = { open: false, acceptingOrders: false, ...correction.closed };
  }
  state.outcome = {
    kind: 'correction',
    text: correction.message,
    details: correction.items.map((item) => item.message),
  };
  render();
  focusById('outcome-message');
  loadMenu();
}

async function checkSavedStatus() {
  if (!state.saved) return;
  state.statusCheck = { state: 'loading' };
  render();
  try {
    const { status, data } = await requestJson(`/api${state.saved.confirmation.trackingPath}`);
    if (status === 200) {
      const final = ['Cancelled', 'Collected'].includes(data.status);
      state.saved.confirmation = {
        ...state.saved.confirmation,
        status: data.status,
        guidance: data.guidance,
        pickupInstructions: final ? null : state.saved.confirmation.pickupInstructions,
      };
      tab.set(KEYS.confirmation, state.saved);
      state.statusCheck = { state: 'current', at: new Date(), timezone: data.timezone };
    } else if (status === 404) {
      state.statusCheck = { state: 'unavailable' };
    } else {
      throw new Error('Status check failed');
    }
  } catch {
    state.statusCheck = { state: 'stale' };
  }
  render();
}

async function copyTrackingLink() {
  try {
    await navigator.clipboard.writeText(trackingUrl());
    state.copyState = 'copied';
  } catch {
    state.copyState = 'failed';
  }
  render();
  if (state.copyState === 'failed') {
    const input = document.getElementById('tracking-link');
    input?.focus();
    input?.select();
  }
}

function startNewOrder() {
  location.hash = '';
  focusById('menu-heading');
}

function focusById(id) {
  const target = document.getElementById(id);
  if (target) {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  }
}

// ---------- rendering ----------

function renderRestaurant() {
  if (!state.menu) {
    replaceContent(elements.restaurant, state.menuFailed ? h('p', { class: 'warning' }, "We couldn't load restaurant details.") : null);
    return;
  }
  const { restaurant, ordering, hours } = state.menu;
  const noUpcoming = !ordering.open && !ordering.acceptingOrders && ordering.nextOpening === null;
  replaceContent(
    elements.restaurant,
    h(
      'p',
      { class: `opening ${ordering.acceptingOrders ? 'opening-open' : 'opening-closed'}` },
      h('span', { class: 'opening-icon', 'aria-hidden': 'true' }, ordering.acceptingOrders ? '●' : '○'),
      ` ${ordering.acceptingOrders ? 'Open now' : ordering.open ? 'Ordering unavailable' : 'Closed'}`,
    ),
    h('p', { class: 'opening-message' }, ordering.message),
    h(
      'p',
      { class: 'hours' },
      hours.length ? `Hours (${restaurant.timezoneLabel}): ${hours.join('; ')}` : 'No opening hours are currently scheduled.',
    ),
    h('p', { class: 'policy' }, restaurant.customerNote, ' ', restaurant.pickupInstructions),
    noUpcoming ? h('p', { class: 'contact' }, 'Contact: ', h('span', {}, restaurant.contact), ` (${restaurant.contactLabel})`) : null,
  );
}

function renderMenu() {
  if (!state.menu) {
    replaceContent(
      elements.menu,
      state.menuFailed
        ? h(
            'div',
            { class: 'warning', role: 'alert' },
            h('p', {}, "We couldn't load the menu. Check your connection and try again."),
            h('button', { type: 'button', class: 'button secondary', onclick: loadMenu }, 'Try again'),
          )
        : h('p', { class: 'loading', role: 'status' }, 'Loading the menu…'),
    );
    return;
  }
  if (state.menu.groups.length === 0) {
    replaceContent(elements.menu, h('p', { class: 'warning' }, 'Ordering is unavailable right now because the menu has no dishes.'));
    return;
  }
  replaceContent(
    elements.menu,
    state.menu.groups.map((group) =>
      h(
        'section',
        { class: 'menu-group', 'aria-labelledby': `group-${group.name}` },
        h('h2', { id: `group-${group.name}` }, group.name),
        h(
          'ul',
          { class: 'dish-list' },
          group.items.map((item) =>
            h(
              'li',
              { class: `dish ${item.available ? '' : 'dish-unavailable'}` },
              h('div', { class: 'dish-text' }, h('h3', {}, item.name), h('p', { class: 'dish-description' }, item.description)),
              h(
                'div',
                { class: 'dish-order' },
                h('p', { class: 'price' }, formatCRC(item.price)),
                item.available
                  ? h(
                      'button',
                      {
                        type: 'button',
                        class: 'button',
                        'data-focus-key': `add-${item.code}`,
                        'aria-label': `Add ${item.name} to cart`,
                        onclick: () => addToCart(item),
                      },
                      'Add',
                    )
                  : h('p', { class: 'unavailable-label' }, h('span', { 'aria-hidden': 'true' }, '✕ '), 'Unavailable — can’t be added'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function cartRow(line) {
  const draft = state.quantityDrafts[line.code];
  const errorId = `quantity-error-${line.code}`;
  const noticeId = `notice-${line.code}`;
  return h(
    'li',
    { class: `cart-row ${line.unavailable ? 'cart-row-unavailable' : ''}` },
    h(
      'div',
      { class: 'cart-row-main' },
      h('p', { class: 'cart-item-name' }, line.reviewedName, line.unavailable ? ' (unavailable)' : null),
      h('p', { class: 'cart-item-price' }, `${formatCRC(line.reviewedPrice)} each`),
    ),
    h(
      'div',
      { class: 'cart-row-controls' },
      h('label', { for: `quantity-${line.code}` }, 'Quantity'),
      h('input', {
        id: `quantity-${line.code}`,
        class: `quantity ${draft ? 'invalid' : ''}`,
        type: 'text',
        inputmode: 'numeric',
        autocomplete: 'off',
        value: draft ? draft.text : String(line.quantity),
        'data-focus-key': `quantity-${line.code}`,
        'aria-label': `Quantity for ${line.reviewedName}`,
        'aria-invalid': draft ? 'true' : null,
        'aria-describedby': [draft ? errorId : null, line.notice ? noticeId : null].filter(Boolean).join(' ') || null,
        onchange: (event) => editQuantity(line.code, event.target.value),
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'button secondary',
          'data-focus-key': `remove-${line.code}`,
          'aria-label': `Remove ${line.reviewedName}`,
          onclick: () => removeFromCart(line.code),
        },
        'Remove',
      ),
      h('p', { class: 'subtotal' }, h('span', { class: 'visually-hidden' }, 'Subtotal '), formatCRC(line.subtotal)),
    ),
    draft ? h('p', { id: errorId, class: 'field-error', role: 'alert' }, draft.message) : null,
    line.notice ? h('p', { id: noticeId, class: 'item-notice' }, line.notice) : null,
  );
}

function renderCart() {
  const { lines, total, count } = calculateTotal(state.cart);
  const blocker = submissionBlocker();
  const onConfirmation = onConfirmationView();

  elements.cartBar.hidden = onConfirmation || state.cart.length === 0;
  elements.cartBar.textContent = `View cart · ${count} ${count === 1 ? 'item' : 'items'} · ${formatCRC(total)}`;

  if (state.cart.length === 0) {
    replaceContent(
      elements.cart,
      h('p', { class: 'empty' }, 'Your cart is empty.'),
      h('p', {}, h('a', { href: '#menu-heading' }, 'Browse the menu'), ' and choose Add to start an order.'),
      h('button', { type: 'button', class: 'button primary', disabled: true, 'aria-describedby': 'submit-help' }, 'Place pickup order'),
      h('p', { id: 'submit-help', class: 'help' }, blocker),
      h('p', { class: 'visually-hidden', role: 'status' }, state.announcement),
    );
    return;
  }

  replaceContent(
    elements.cart,
    h('ul', { class: 'cart-rows' }, lines.map(cartRow)),
    h('p', { class: 'total' }, 'Total ', h('strong', {}, formatCRC(total))),
    h('p', { class: 'help' }, 'Prices include taxes. No extra fees. Pay at collection — there is no online payment.'),
    h(
      'button',
      {
        type: 'button',
        class: 'button primary',
        'data-focus-key': 'place-order',
        disabled: Boolean(blocker),
        'aria-describedby': 'submit-help',
        onclick: placeOrder,
      },
      'Place pickup order',
    ),
    h('p', { id: 'submit-help', class: blocker ? 'help blocker' : 'help' }, blocker ?? `You will pay ${formatCRC(total)} when you collect your order.`),
    h('p', { class: 'visually-hidden', role: 'status' }, state.announcement),
  );
}

function pendingPanel() {
  if (!state.pending) return null;
  const busy = state.submitting || state.recovering;
  return h(
    'section',
    { class: 'panel warning', 'aria-labelledby': 'pending-heading' },
    h('h2', { id: 'pending-heading', tabindex: '-1' }, state.submitting ? 'Placing your order…' : "We couldn't confirm the result"),
    state.submitting
      ? h('p', { role: 'status' }, 'Waiting for the restaurant to confirm this order. Please keep this page open.')
      : h('p', { role: 'alert' }, "We couldn't confirm the result. Check this order before placing another."),
    h('p', {}, 'This attempt:'),
    h(
      'ul',
      { class: 'compact-list' },
      state.pending.lines.map((line) => h('li', {}, `${line.quantity} × ${line.name} — ${formatCRC(line.subtotal)}`)),
    ),
    h('p', {}, `Total ${formatCRC(state.pending.total)}`),
    state.submitting
      ? null
      : h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'button', class: 'button primary', disabled: busy, onclick: checkPending }, state.recovering ? 'Checking…' : 'Check order'),
          h('button', { type: 'button', class: 'button secondary', disabled: busy, onclick: submitPending }, 'Retry safely'),
        ),
    state.submitting ? null : h('p', { class: 'help' }, 'Retry safely sends this same attempt again. It cannot create a second order.'),
    state.recoveryMessage ? h('p', { class: 'recovery-message', role: 'status' }, state.recoveryMessage) : null,
  );
}

function renderNotices() {
  const outcome = state.outcome;
  replaceContent(
    elements.notices,
    pendingPanel(),
    outcome && !state.pending && outcome.kind !== 'progress'
      ? h(
          'div',
          { id: 'outcome-message', class: `panel ${outcome.kind === 'error' ? 'error' : 'notice'}`, role: 'alert', tabindex: '-1' },
          h('p', {}, outcome.text),
          outcome.details?.length ? h('ul', { class: 'compact-list' }, outcome.details.map((text) => h('li', {}, text))) : null,
          outcome.kind === 'correction' ? h('p', {}, 'Your cart was kept. Review it, then place the order again when ready.') : null,
        )
      : null,
    state.saved && !onConfirmationView()
      ? h(
          'p',
          { class: 'panel recent-order' },
          `Your order ${state.saved.confirmation.orderNumber} is saved in this tab. `,
          h('a', { href: '#confirmation' }, 'View confirmation and tracking link'),
        )
      : null,
  );
}

function statusFreshness() {
  const check = state.statusCheck;
  if (!check || check.state === 'fresh') return null;
  if (check.state === 'loading') return h('p', { class: 'help', role: 'status' }, 'Showing the last known status. Checking the current status…');
  if (check.state === 'current') {
    return h('p', { class: 'help', role: 'status' }, `Current status checked at ${formatCheckTime(check.at, check.timezone)}.`);
  }
  if (check.state === 'unavailable') {
    return h('p', { class: 'warning', role: 'alert' }, "We couldn't open this tracking link. Check the full saved link.");
  }
  return h(
    'div',
    { class: 'warning', role: 'alert' },
    h('p', {}, "We couldn't check the current status. This status may be out of date. Your tracking link still works."),
    h('button', { type: 'button', class: 'button secondary', onclick: checkSavedStatus }, 'Check status again'),
  );
}

function renderConfirmation() {
  const { confirmation, differentSelection } = state.saved;
  const final = ['Cancelled', 'Collected'].includes(confirmation.status);
  const link = trackingUrl();
  replaceContent(
    elements.confirmation,
    h('h1', { id: 'confirmation-heading', tabindex: '-1' }, confirmation.status === 'Received' ? 'Order received' : 'Your order'),
    h('p', { class: 'order-number' }, 'Order number ', h('strong', {}, String(confirmation.orderNumber))),
    differentSelection
      ? h('p', { class: 'notice' }, 'This attempt was already placed with its original items. Changes made afterwards were not ordered.')
      : null,
    h(
      'div',
      { class: 'status-block' },
      h('p', {}, 'Status: ', statusBadge(confirmation.status)),
      h('p', {}, confirmation.guidance.message),
      confirmation.status === 'Cancelled' ? h('p', {}, 'View order progress for the reason and the restaurant contact.') : null,
      statusFreshness(),
    ),
    h('h2', {}, 'Items'),
    h(
      'ul',
      { class: 'compact-list' },
      confirmation.items.map((item) => h('li', {}, `${item.quantity} × ${item.name} (${formatCRC(item.unitPrice)} each) — ${formatCRC(item.subtotal)}`)),
    ),
    h('p', { class: 'total' }, 'Total ', h('strong', {}, formatCRC(confirmation.total))),
    !final
      ? h('div', { class: 'panel payment' }, h('p', {}, h('strong', {}, 'Pay at collection.'), ' There is no online payment.'), confirmation.pickupInstructions ? h('p', {}, confirmation.pickupInstructions) : null)
      : null,
    h(
      'section',
      { class: 'panel tracking-link', 'aria-labelledby': 'link-heading' },
      h('h2', { id: 'link-heading' }, 'Your private tracking link'),
      h('p', {}, 'Save this link or bookmark the tracking page so you can check your order later. Anyone with this link can view this order.'),
      state.confirmationStored ? null : h('p', { class: 'warning', role: 'alert' }, 'Save this tracking link before leaving this page.'),
      h('label', { for: 'tracking-link' }, 'Tracking link'),
      h('input', { id: 'tracking-link', class: 'link-field', type: 'text', readonly: true, value: link, onfocus: (event) => event.target.select() }),
      h(
        'div',
        { class: 'button-row' },
        h('button', { type: 'button', class: 'button primary', 'data-focus-key': 'copy-link', onclick: copyTrackingLink }, 'Copy tracking link'),
        h('a', { class: 'button secondary', href: confirmation.trackingPath }, 'View order progress'),
      ),
      h(
        'p',
        { class: 'copy-feedback', role: 'status' },
        state.copyState === 'copied' ? 'Link copied' : state.copyState === 'failed' ? "Copying didn't work. The link above is selected: copy it manually and save it." : '',
      ),
    ),
    h('p', { class: 'help' }, 'Orders can’t be changed or cancelled online. Restaurant staff handle any changes or cancellations.'),
    h('button', { type: 'button', class: 'button secondary', onclick: startNewOrder }, 'Start a new order'),
  );
}

function render() {
  const confirmationView = onConfirmationView();
  elements.menuView.hidden = confirmationView;
  elements.confirmation.hidden = !confirmationView;
  renderRestaurant();
  renderNotices();
  if (confirmationView) {
    renderConfirmation();
  } else {
    renderMenu();
  }
  renderCart();
  state.announcement = '';
}

function showView() {
  if (location.hash === '#confirmation' && !state.saved) {
    history.replaceState(null, '', location.pathname);
  }
  if (onConfirmationView()) {
    if (state.statusCheck?.state !== 'fresh') checkSavedStatus();
  } else {
    state.statusCheck = null;
    state.copyState = 'idle';
  }
  render();
}

window.addEventListener('hashchange', showView);
window.addEventListener('pageshow', (event) => {
  if (event.persisted && onConfirmationView()) checkSavedStatus();
});

showView();
loadMenu();
