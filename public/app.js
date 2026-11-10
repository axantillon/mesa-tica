import { $, escape, money, time, announce, api, summary, readStorage, writeStorage, observe } from './shared.js';

const key = 'mesa-customer-v1';
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
let state = readStorage('localStorage', key, { context: random(), cart: [], pending: null, confirmation: null });
let menu;
let busy = false;
let correction = '';
let storageFailed = false;
let observer;
let routeGeneration = 0;
const main = $('#main');

function save() {
  const saved = writeStorage('localStorage', key, state);
  storageFailed = !saved;
  return saved;
}
function count() { $('#cart-count').textContent = state.cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0); }
function validQuantity(value) { return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 999; }
function total() { return state.cart.reduce((sum, item) => sum + (validQuantity(item.quantity) ? Number(item.quantity) * item.price : 0), 0); }
function cartMarkup() {
  const pending = !!state.pending;
  const invalid = state.cart.some(item => !validQuantity(item.quantity) || item.unavailable);
  return `<h2>Your pickup order</h2><p class="muted">Pay at collection · No extra fees</p>
    ${correction ? `<div class="notice error-box" role="alert">${escape(correction)}</div>` : ''}
    ${state.cart.length ? state.cart.map(item => `<div class="cart-row" data-cart-id="${escape(item.id)}"><div class="row"><strong>${escape(item.name)}</strong><span>${money(item.price)}</span></div>
      <label for="qty-${escape(item.id)}">Quantity for ${escape(item.name)}</label><input id="qty-${escape(item.id)}" data-quantity="${escape(item.id)}" value="${escape(item.quantity)}" inputmode="numeric" aria-describedby="err-${escape(item.id)}" ${pending ? 'disabled' : ''}>
      <button class="secondary" data-remove="${escape(item.id)}" ${pending ? 'disabled' : ''}>Remove ${escape(item.name)}</button>
      <p class="error" id="err-${escape(item.id)}">${!validQuantity(item.quantity) ? 'Enter a whole number greater than zero (maximum 999).' : item.unavailable ? 'This dish is unavailable. Remove it or choose another item.' : ''}</p>
      <small>Subtotal <span data-subtotal="${escape(item.id)}">${validQuantity(item.quantity) ? money(Number(item.quantity) * item.price) : '—'}</span></small></div>`).join('') : '<p>Your cart is empty. Choose a dish from the menu.</p>'}
    <div class="row total"><span>Total</span><span id="cart-total">${money(total())}</span></div>
    <p><small>Your selection is not a reservation. Prices and availability are checked when you order.</small></p>
    ${pending ? `<div class="notice" role="${busy ? 'status' : 'alert'}">${busy ? 'Checking your order… Please wait for confirmation.' : "We couldn't confirm the result. Check this order before placing another."}</div><div class="stack"><button id="check-order" ${busy ? 'disabled' : ''}>Check order</button><button id="retry-order" class="secondary" ${busy ? 'disabled' : ''}>Retry safely</button></div>` : `<button id="place-order" ${!menu?.opening.isOpen || !state.cart.length || invalid || busy ? 'disabled' : ''}>${busy ? 'Placing your order…' : 'Place pickup order'}</button>`}
    <p id="cart-opening" class="notice" ${menu?.opening.isOpen ? 'hidden' : ''}>${escape(menu?.opening.message || 'Opening information unavailable. Please retry.')}</p>
    ${storageFailed ? '<p class="notice">Browser saving is unavailable. Keep this page open during ordering and save your tracking link before leaving.</p>' : ''}`;
}
function renderMenu() {
  observer?.stop();
  main.innerHTML = `<section class="intro"><p class="eyebrow">Fresh from the kitchen</p><h1>A good meal.<br>A simple pickup.</h1><p>Choose your favorites, place your order, and follow its progress.</p><span class="status" id="opening-state">${menu.opening.isOpen ? 'Open for pickup' : 'Ordering closed'}</span><p class="muted">Every day, 10:00 AM–9:00 PM · Costa Rica time<br>Pickup only. Pay at collection. Keep your tracking link private.</p><p class="notice" id="menu-opening" ${menu.opening.isOpen ? 'hidden' : ''}>${escape(menu.opening.message)}</p></section>
    ${state.confirmation ? '<p><a class="button secondary" href="/#confirmation">Return to your last order</a></p>' : ''}
    <div class="layout"><section id="menu" aria-label="Menu">${menu.items.length ? ['Meals', 'Sides', 'Drinks'].map(group => `<section class="category"><h2>${group}</h2>${menu.items.filter(item => item.group === group).map(item => `<article class="dish ${item.available ? '' : 'unavailable'}"><div><h3>${escape(item.name)}</h3><p>${escape(item.description)}</p><span class="price">${money(item.price)}</span>${item.available ? '' : ' · Unavailable'}</div><button class="secondary" data-add="${item.id}" ${!item.available || state.pending ? 'disabled' : ''} aria-label="${item.available ? `Add ${escape(item.name)}` : `${escape(item.name)} unavailable`}">${item.available ? 'Add +' : 'Unavailable'}</button></article>`).join('')}</section>`).join('') : '<div class="notice">The menu is empty. Ordering is unavailable. Please check the demo contact.</div>'}</section><aside id="cart" class="panel cart-panel" aria-label="Your cart">${cartMarkup()}</aside></div>`;
  count();
  main.onclick = event => {
    const add = event.target.closest('[data-add]');
    const remove = event.target.closest('[data-remove]');
    if (add && !state.pending) {
      const dish = menu.items.find(item => item.id === add.dataset.add);
      const existing = state.cart.find(item => item.id === dish.id);
      if (existing) existing.quantity = validQuantity(existing.quantity) ? Math.min(999, Number(existing.quantity) + 1) : existing.quantity;
      else state.cart.push({ id: dish.id, name: dish.name, price: dish.price, quantity: 1 });
      save(); updateCart(); announce(`${dish.name} added to your cart.`);
    }
    if (remove && !state.pending) { state.cart = state.cart.filter(item => item.id !== remove.dataset.remove); save(); updateCart(); }
    if (event.target.id === 'place-order') submit(false);
    if (event.target.id === 'check-order') recover();
    if (event.target.id === 'retry-order') submit(true);
  };
  $('#cart').oninput = event => {
    const input = event.target.closest('[data-quantity]');
    if (!input || state.pending) return;
    const item = state.cart.find(item => item.id === input.dataset.quantity);
    item.quantity = input.value;
    save();
    const valid = validQuantity(input.value);
    input.setAttribute('aria-invalid', String(!valid));
    $(`#err-${item.id}`).textContent = valid ? '' : 'Enter a whole number greater than zero (maximum 999).';
    $(`[data-subtotal="${item.id}"]`).textContent = valid ? money(Number(input.value) * item.price) : '—';
    $('#cart-total').textContent = money(total());
    $('#place-order').disabled = !menu.opening.isOpen || state.cart.some(row => !validQuantity(row.quantity) || row.unavailable);
    count();
  };
}
function updateCart() {
  $('#cart').innerHTML = cartMarkup();
  count();
  for (const button of main.querySelectorAll('[data-add]')) button.disabled = !!state.pending || !menu.items.find(item => item.id === button.dataset.add).available;
}
async function submit(retry) {
  if (busy) return;
  if (!retry) {
    state.pending = { attempt: random(), selection: state.cart.map(item => ({ ...item, quantity: Number(item.quantity) })) };
    correction = '';
    save();
  }
  busy = true;
  updateCart();
  try {
    const result = await api('/api/checkout', { method: 'POST', headers: { 'X-Customer-Context': state.context }, body: JSON.stringify(state.pending) });
    await outcome(result);
  } catch { correction = "We couldn't confirm the result. Check this order before placing another."; }
  finally { busy = false; if ($('#cart')) updateCart(); }
}
async function recover() {
  if (busy || !state.pending) return;
  busy = true; updateCart();
  try { await outcome(await api('/api/attempts/check', { method: 'POST', headers: { 'X-Customer-Context': state.context }, body: JSON.stringify({ attempt: state.pending.attempt }) })); }
  catch { correction = 'Check unavailable. Your outcome is still uncertain; check again or retry safely.'; }
  finally { busy = false; if ($('#cart')) updateCart(); }
}
async function outcome(result) {
  if (result.outcome === 'accepted') {
    const pending = state.pending;
    state = { ...state, confirmation: result, pending: null, cart: [] };
    // Save acceptance plus cleared cart together, before dropping the in-memory attempt.
    if (!save()) state.pending = pending;
    count();
    location.hash = 'confirmation';
    renderTracking(result.privateKey, result.order, true);
  } else if (result.outcome === 'rejected') {
    state.pending = null;
    correction = result.corrections.map(item => item.message).join(' ');
    for (const item of result.corrections) {
      const row = state.cart.find(row => row.id === item.id);
      if (row && item.price !== undefined) row.price = item.price;
      if (row && item.unavailable) row.unavailable = true;
    }
    save();
    try { menu = await api('/api/menu'); } catch { /* Keep correction usable without a menu refresh. */ }
    renderMenu();
  } else correction = 'No recorded result yet. The outcome remains uncertain. Retry safely to resolve this attempt.';
}
function renderTracking(privateKey, cached, confirmation) {
  observer?.stop();
  main.onclick = null;
  const link = `${location.origin}/track#${privateKey}`;
  main.innerHTML = `<section class="summary"><p class="eyebrow">${confirmation ? 'Your pickup order' : 'Order progress'}</p><h1>${confirmation ? (cached && cached.status !== 'Received' ? `Order ${escape(cached.status.toLowerCase())}` : 'Order received') : 'Follow your order'}</h1><div id="freshness" role="status">${cached ? 'Last known information — checking current status…' : 'Loading current order…'}</div><div id="order-summary">${cached ? `<div class="panel">${summary(cached)}<p>${escape(cached.guidance)}</p></div>` : ''}</div><section class="panel"><h2>Keep your private link</h2><p>Save this link or bookmark the tracking page so you can check your order later. Anyone with this link can view this order.</p><label for="tracking-link">Private tracking link</label><input id="tracking-link" readonly value="${escape(link)}"><div class="actions"><button id="copy-link">Copy tracking link</button><a class="button secondary" href="${escape(link)}">View progress</a></div><p id="copy-feedback" role="status"></p><p id="storage-warning" class="notice" ${storageFailed ? '' : 'hidden'}>Save this tracking link before leaving this page. Browser saving is unavailable.</p><small>Changes or cancellation are handled by restaurant staff. There are no customer edit or cancel controls.</small></section><a href="/#menu">Back to menu / start a new order</a></section>`;
  $('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(link); $('#copy-feedback').textContent = 'Link copied.'; }
    catch { $('#tracking-link').focus(); $('#tracking-link').select(); $('#copy-feedback').textContent = 'Copy unavailable. Select and copy the link above manually.'; }
  };
  let checkedAt;
  let last = cached;
  observer = observe(() => api(`/api/tracking/${encodeURIComponent(privateKey)}`), result => {
    checkedAt = result.checkedAt;
    if (last?.status !== result.order.status) announce(`Order ${result.order.number}: ${result.order.status}. ${result.order.guidance}`);
    last = result.order;
    if (confirmation && state.confirmation) {
      state.confirmation.order = result.order;
      save();
      $('#storage-warning').hidden = !storageFailed;
      $('h1', main).textContent = result.order.status === 'Received' ? 'Order received' : `Order ${result.order.status.toLowerCase()}`;
    }
    $('#freshness').className = 'muted';
    $('#freshness').textContent = `Last checked ${time(checkedAt)} · Automatic updates`;
    $('#order-summary').innerHTML = `<div class="panel">${summary(result.order)}<p class="notice">${escape(result.order.guidance)}</p>${['Received', 'Preparing'].includes(result.order.status) ? '<p>Pay at collection.</p>' : ''}</div>`;
  }, error => {
    if (error.status === 404) {
      $('#order-summary').innerHTML = '';
      $('#freshness').textContent = error.message;
    } else $('#freshness').textContent = `Updates are unavailable. ${last ? `This status may be out of date.${checkedAt ? ` Last checked ${time(checkedAt)}.` : ' Cached information has not been checked.'}` : 'No current order information has loaded. Try again when connected.'}`;
    $('#freshness').className = 'notice';
  });
}
async function route() {
  const generation = ++routeGeneration;
  observer?.stop();
  count();
  if (location.pathname === '/track') return renderTracking(location.hash.slice(1), null, false);
  if (location.hash === '#confirmation' && state.confirmation) return renderTracking(state.confirmation.privateKey, state.confirmation.order, true);
  try {
    const loaded = await api('/api/menu');
    if (generation !== routeGeneration) return;
    menu = loaded;
    // On return the server supplies current review values, but correction still requires an explicit submit.
    const changes = [];
    for (const row of state.cart) {
      const dish = menu.items.find(item => item.id === row.id);
      if (!state.pending && dish && dish.price !== row.price) { row.price = dish.price; changes.push(`${row.name} is now ${money(dish.price)}. Review the updated total.`); }
      row.unavailable = !dish?.available;
    }
    if (changes.length) correction = changes.join(' ');
    save(); renderMenu();
  } catch { if (generation !== routeGeneration) return; main.innerHTML = '<h1>Menu unavailable</h1><p role="alert">We could not load the menu. Your saved selection is retained. Check your connection and reload.</p><button id="reload-menu">Try again</button>'; $('#reload-menu').onclick = route; }
}
window.addEventListener('hashchange', route);
window.addEventListener('pageshow', event => { if (event.persisted) route(); });
if (location.pathname === '/' && !location.hash && state.confirmation && !state.pending) location.hash = 'confirmation';
else route();
// Keep opening information current without rebuilding inputs or moving focus.
setInterval(async () => {
  if (!$('#cart') || !menu) return;
  try {
    const fresh = await api('/api/menu');
    menu.opening = fresh.opening;
    $('#opening-state').textContent = fresh.opening.isOpen ? 'Open for pickup' : 'Ordering closed';
    for (const selector of ['#cart-opening', '#menu-opening']) {
      const notice = $(selector);
      notice.hidden = fresh.opening.isOpen;
      notice.textContent = fresh.opening.message;
    }
    const submitButton = $('#place-order');
    if (submitButton) submitButton.disabled = !fresh.opening.isOpen || !state.cart.length || busy || state.cart.some(item => !validQuantity(item.quantity) || item.unavailable);
  } catch { /* Acceptance always checks real server time. */ }
}, 10000);
