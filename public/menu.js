import { $, badge, escape, itemSummary, money, orderNumber, request, statusMessage } from './common.js';

const storageKey = 'mesa.ordering.v1';
const empty = () => ({ cart: [], customer: null, pending: null, receipt: null });
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
  byte.toString(16).padStart(2, '0')).join('');

function load() {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  return saved ?? empty();
}

let state = empty();
let storageAvailable = Boolean(navigator.locks);
try {
  state = load();
} catch {
  storageAvailable = false;
}

let snapshot;
let unavailable = false;
let working = false;
let correction = '';
let activeMenuKey;
const drafts = new Map();
const announcer = $('#announcer');

async function update(edit) {
  if (!storageAvailable) return false;
  try {
    return await navigator.locks.request(storageKey, () => {
      const latest = load();
      const changed = edit(latest);
      if (changed !== false) localStorage.setItem(storageKey, JSON.stringify(latest));
      state = latest;
      return changed !== false;
    });
  } catch {
    storageAvailable = false;
    return false;
  }
}

function clock(time) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function openingText({ opening, restaurant }) {
  if (opening.open) return 'Open for pickup';
  if (!opening.next) return 'Ordering is closed. Contact ' + restaurant.contact + ' · ' + restaurant.contactLabel;
  const date = new Date(opening.next.date + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return `Ordering is closed. Opens ${date} at ${clock(opening.next.time)} (Costa Rica time).`;
}

function hoursText({ hours }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const interval = (range) => range ? range.map(clock).join('–') : 'Closed';
  if (hours.every((day) => interval(day) === interval(hours[0]))) {
    return `Daily · ${interval(hours[0])} · Costa Rica time`;
  }
  return hours.map((day, index) => `${days[index]} ${interval(day)}`).join(' · ') + ' · Costa Rica time';
}

function renderMenu() {
  if (!snapshot) return;
  const { menu } = snapshot;
  const key = JSON.stringify(menu);
  if (activeMenuKey !== key) {
    activeMenuKey = key;
    const focused = document.activeElement?.dataset.add;
    $('#menu').innerHTML = menu.length ? [...new Set(menu.map((dish) => dish.category))].map((category) => `
      <section class="menu-group"><h2>${escape(category)}</h2><ul class="menu-list">
      ${menu.filter((dish) => dish.category === category).map((dish) => `
        <li class="dish">
          <div><h3>${escape(dish.name)}</h3><p>${escape(dish.description)}</p></div>
          <div class="dish-actions"><strong>${money(dish.price)}</strong>
            ${dish.available
              ? `<button type="button" class="button quiet" data-add="${escape(dish.code)}" aria-label="Add ${escape(dish.name)}">Add</button>`
              : '<span class="badge">Unavailable</span>'}
          </div>
        </li>`).join('')}
      </ul></section>`).join('') : '<p class="notice">The menu is empty. Ordering is currently unavailable.</p>';
    if (focused) [...document.querySelectorAll('[data-add]')].find((button) => button.dataset.add === focused)?.focus();
  }
  for (const button of document.querySelectorAll('[data-add]')) {
    button.disabled = Boolean(state.pending || !storageAvailable);
  }
}

function dishFor(code) {
  return snapshot?.menu.find((dish) => dish.code === code);
}

const totalFor = (cart) => cart.reduce((total, line) => total + line.price * line.quantity, 0);
const quantityHint = 'Enter a whole number greater than zero.';

function inspect(line) {
  const dish = dishFor(line.code);
  if (snapshot && !dish?.available) return { message: `${line.name} is no longer available. Remove it or choose another item.`, unavailable: true };
  if (dish && dish.price !== line.price) {
    return { message: `${line.name} is now ${money(dish.price)}. Review your updated total before placing the order.`, repriced: true };
  }
  return {};
}

function renderActions() {
  const pending = state.pending;
  const issues = state.cart.map(inspect);
  const invalid = state.cart.some((line) => drafts.has(line.code)) || !Number.isSafeInteger(totalFor(state.cart));
  const blocked = !snapshot?.opening.open || unavailable || !storageAvailable || !state.cart.length ||
    invalid || issues.some((issue) => issue.unavailable || issue.repriced);
  const notice = !storageAvailable ? 'Browser storage is unavailable. Enable it and reload to order safely.'
    : pending ? (working ? 'Checking your order…' : "We couldn't confirm the result. Check this order before placing another.")
    : correction;
  const noticeNode = $('#cart-notice');
  if (noticeNode.textContent !== notice) noticeNode.textContent = notice;
  noticeNode.className = notice ? 'notice' : '';

  const actions = $('#cart-actions');
  const markup = pending ? `
    <div class="total"><span>Reviewed total</span><strong>${money(totalFor(pending.selection))}</strong></div>
    <div class="actions"><button class="button" data-action="check" ${working ? 'disabled' : ''}>Check order</button>
    <button class="button quiet" data-action="retry" ${working ? 'disabled' : ''}>Retry safely</button></div>`
    : `<div class="total"><span>Total</span><strong>${money(totalFor(state.cart))}</strong></div>
      <p class="small">Pay at collection · Prices include taxes</p>
      ${!snapshot || unavailable ? '<p class="small">Waiting for current menu and ordering hours.</p>'
        : !snapshot.opening.open ? `<p class="small">${escape(openingText(snapshot))}</p>` : ''}
      ${issues.some((issue) => issue.repriced) ? '<button class="button quiet full" data-action="review">Review updated prices</button>' : ''}
      <button class="button full" data-action="place" ${blocked ? 'disabled' : ''}>Place pickup order</button>`;
  if (actions.dataset.markup !== markup) {
    const focused = document.activeElement?.dataset.action;
    actions.dataset.markup = markup;
    actions.innerHTML = markup;
    if (focused) {
      const next = actions.querySelector(`[data-action="${focused}"]`);
      if (next && !next.disabled) next.focus();
    }
  }
  const count = (pending?.selection ?? state.cart).reduce((sum, line) => sum + line.quantity, 0);
  $('#cart-shortcut').textContent = pending ? 'Check your order' : `View cart · ${count} · ${money(totalFor(state.cart))}`;
  $('#cart-shortcut').hidden = !count || Boolean(state.receipt);
}

function renderCart() {
  const cart = state.pending?.selection ?? state.cart;
  const activeCode = document.activeElement?.dataset.quantity ?? document.activeElement?.dataset.remove;
  const activeType = document.activeElement?.dataset.quantity === undefined ? 'remove' : 'quantity';
  const list = $('#cart-lines');
  list.innerHTML = cart.length ? `<ul class="cart-list">${cart.map((line) => {
    const issue = state.pending ? {} : inspect(line);
    const draft = drafts.get(line.code);
    return `<li>
      <div class="cart-line-head"><strong>${escape(line.name)}</strong><strong data-subtotal="${escape(line.code)}">${money(line.price * line.quantity)}</strong></div>
      <p class="small">${money(line.price)} each</p>
      ${state.pending ? `<p>Quantity ${line.quantity}</p>` : `
        <div class="cart-controls">
          <label>Qty <input inputmode="numeric" autocomplete="off" aria-label="${escape(line.name)} quantity"
            data-quantity="${escape(line.code)}" value="${escape(draft ?? line.quantity)}"
            aria-describedby="qty-${escape(line.code)}" aria-invalid="${draft !== undefined}"></label>
          <button type="button" class="button text" data-remove="${escape(line.code)}" aria-label="Remove ${escape(line.name)}">Remove</button>
        </div>
        <p class="field-error" id="qty-${escape(line.code)}" ${draft === undefined ? 'hidden' : ''}>${quantityHint}</p>
        <p class="field-error" data-issue="${escape(line.code)}" ${issue.message ? '' : 'hidden'}>${escape(issue.message)}</p>`}
      </li>`;
  }).join('')}</ul>` : '<p class="small">Your cart is empty. Choose a dish from the menu to get started.</p>';
  if (activeCode) {
    const control = [...list.querySelectorAll(`[data-${activeType}]`)].find((item) => item.dataset[activeType] === activeCode);
    (control ?? $('#cart-heading')).focus();
  }
  renderActions();
}

function render({ focusReceipt = false } = {}) {
  const receipt = $('#receipt');
  const { receipt: result } = state;
  $('#hero').hidden = $('#layout').hidden = Boolean(result);
  receipt.hidden = !result;
  if (!result) {
    delete receipt.dataset.number;
    renderMenu();
    renderCart();
    return;
  }
  $('#cart-shortcut').hidden = true;
  if (receipt.dataset.number !== String(result.order.number)) {
    receipt.dataset.number = result.order.number;
    const { order, trackingPath } = result;
    const title = order.status === 'Received' ? 'Order received' : 'Order ' + order.status.toLowerCase();
    receipt.innerHTML = `
      <p class="eyebrow">Pickup order · ${orderNumber(order.number)}</p>
      <h1 tabindex="-1">${title}</h1>
      ${badge(order.status)}
      <p>${statusMessage[order.status]}</p>
      ${result.differentSelection ? '<p class="notice">A different selection was not ordered. Your original order is shown below.</p>' : ''}
      ${['Cancelled', 'Collected'].includes(order.status) ? '' : '<p><strong>Pay at collection.</strong> Show your order number at the Mesa Tica pickup counter.</p>'}
      ${itemSummary(order)}
      <div class="actions">
        <a class="button" href="${escape(trackingPath)}">View order progress</a>
        <button class="button quiet" data-action="copy">Copy tracking link</button>
      </div>
      <p id="copy-result" role="status"></p>
      <label id="manual-copy" hidden>Private tracking link
        <input readonly id="tracking-url" value="${escape(new URL(trackingPath, location.origin).href)}">
      </label>
      <p class="small">Save this link or bookmark the tracking page. Anyone with the link can view your order, so keep it private.</p>
      <p class="small">Contact restaurant staff about changes or cancellation.</p>
      <button class="button text" data-action="new">Back to menu</button>`;
  }
  if (focusReceipt) $('h1', receipt).focus();
}

async function refreshMenu() {
  try {
    snapshot = await request('/api/menu');
    unavailable = false;
    $('#opening').textContent = openingText(snapshot);
    $('#hours').textContent = hoursText(snapshot.restaurant);
    renderMenu();
    for (const label of document.querySelectorAll('[data-issue]')) {
      const line = state.cart.find(({ code }) => code === label.dataset.issue);
      const issue = line ? inspect(line) : {};
      label.textContent = issue.message ?? '';
      label.hidden = !issue.message;
    }
  } catch {
    unavailable = true;
    $('#opening').textContent = 'Could not check ordering hours. Retrying…';
    if (!snapshot) $('#menu').textContent = 'The menu could not load. Retrying…';
  } finally {
    if (!state.receipt) renderActions();
    setTimeout(refreshMenu, 3000);
  }
}

async function submit(action) {
  if (working || !storageAvailable) return;
  working = true;
  correction = '';
  try {
    if (action === 'place') {
      const displayed = JSON.stringify(state.cart);
      const began = await update((latest) => {
        if (latest.pending || latest.receipt || displayed !== JSON.stringify(latest.cart)) return false;
        latest.customer ??= random();
        latest.pending = { attempt: random(), selection: structuredClone(latest.cart) };
      });
      if (!began) return;
    }
    const pending = state.pending;
    if (!pending) return;
    render();
    if (action === 'place') $('#cart-notice').textContent = 'Placing your order…';
    const result = await request('/api/checkout/' + (action === 'check' ? 'check' : 'submit'), {
      customer: state.customer, ...pending,
    });
    if (result.outcome === 'accepted') {
      await update((latest) => {
        if (latest.pending?.attempt !== pending.attempt) return false;
        if (!result.differentSelection) latest.cart = [];
        latest.pending = null;
        latest.receipt = result;
      });
    } else if (result.outcome === 'rejected') {
      await update((latest) => {
        if (latest.pending?.attempt !== pending.attempt) return false;
        latest.pending = null;
      });
      if (result.issue === 'closed' && snapshot) {
        snapshot.opening = result.opening;
        $('#opening').textContent = openingText(snapshot);
      }
      correction = ({
        closed: snapshot ? openingText(snapshot) : 'Ordering is currently closed.',
        review: 'The menu changed. Review the corrections in your cart and place the order again when ready.',
        empty: 'Choose at least one dish.',
        invalid_selection: quantityHint,
        total_too_large: 'The total is too large. Reduce the quantity.',
      })[result.issue] ?? 'Review your cart and try again.';
      // Corrections come from the authoritative attempt, even before the next scheduled menu check.
      for (const fix of result.corrections) {
        const dish = dishFor(fix.code);
        if (dish && fix.issue === 'price_changed') dish.price = fix.price;
        if (dish && fix.issue === 'unavailable') dish.available = 0;
      }
    }
  } catch {
    // Keep the saved attempt and its selection for a later check or safe retry.
  } finally {
    working = false;
    render({ focusReceipt: Boolean(state.receipt) });
    if (state.pending) $('#cart-notice').focus();
  }
}

$('#menu').addEventListener('click', async ({ target }) => {
  const button = target.closest('[data-add]');
  const dish = dishFor(button?.dataset.add);
  if (!dish?.available) return;
  const added = await update((latest) => {
    if (latest.pending || latest.receipt) return false;
    const line = latest.cart.find(({ code }) => code === dish.code);
    if (line) {
      if (!Number.isSafeInteger(line.quantity + 1)) return false;
      line.quantity++;
    } else {
      latest.cart.push({ code: dish.code, name: dish.name, price: dish.price, quantity: 1 });
    }
  });
  if (added) announcer.textContent = `${dish.name} added. ${state.cart.find(({ code }) => code === dish.code).quantity} in cart.`;
  render();
});

$('#cart').addEventListener('input', async ({ target }) => {
  const code = target.dataset.quantity;
  if (!code) return;
  const raw = target.value;
  const quantity = Number(raw);
  const valid = /^\d+$/.test(raw) && Number.isSafeInteger(quantity) && quantity > 0;
  if (valid) {
    drafts.delete(code);
    const saved = await update((latest) => {
      const line = latest.cart.find((item) => item.code === code);
      if (!line || latest.pending || latest.receipt) return false;
      line.quantity = quantity;
    });
    if (!saved) return render();
    const line = state.cart.find((item) => item.code === code);
    target.closest('li').querySelector('[data-subtotal]').textContent = money(line.price * line.quantity);
  } else {
    drafts.set(code, raw);
  }
  target.setAttribute('aria-invalid', String(!valid));
  document.getElementById('qty-' + code).hidden = valid;
  renderActions();
});

$('#cart').addEventListener('click', async ({ target }) => {
  const remove = target.closest('[data-remove]')?.dataset.remove;
  const action = target.closest('[data-action]')?.dataset.action;
  if (remove) {
    await update((latest) => {
      if (latest.pending || latest.receipt) return false;
      latest.cart = latest.cart.filter((line) => line.code !== remove);
    });
    drafts.delete(remove);
    render();
  } else if (action === 'review') {
    await update((latest) => {
      if (latest.pending || latest.receipt) return false;
      for (const line of latest.cart) {
        const dish = dishFor(line.code);
        if (dish?.available) line.price = dish.price;
      }
    });
    correction = 'Prices updated. Review your total before placing the order.';
    render();
    $('#cart-heading').focus();
  } else if (action) {
    await submit(action);
  }
});

$('#receipt').addEventListener('click', async ({ target }) => {
  const action = target.closest('[data-action]')?.dataset.action;
  if (action === 'new') {
    await update((latest) => { latest.receipt = null; });
    correction = '';
    render();
    $('#hero h1').setAttribute('tabindex', '-1');
    $('#hero h1').focus();
  }
  if (action === 'copy') {
    const input = $('#tracking-url');
    try {
      await navigator.clipboard.writeText(input.value);
      $('#copy-result').textContent = 'Link copied';
    } catch {
      $('#copy-result').textContent = 'Copy the selected link manually.';
      $('#manual-copy').hidden = false;
      input.focus();
      input.select();
    }
  }
});

window.addEventListener('storage', ({ key }) => {
  if (key !== storageKey && key !== null) return;
  try { state = load(); } catch { storageAvailable = false; }
  render();
});

$('#cart-notice').tabIndex = -1;
$('#cart-shortcut').addEventListener('click', () => $('#cart-heading').focus({ preventScroll: true }));
render();
await refreshMenu();
