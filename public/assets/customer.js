import { api, html, money, patch } from '/assets/shared.js';

const header = document.getElementById('site-header');
const view = document.getElementById('view');

let menu = null;

function renderHeader() {
  if (!menu) return patch(header, html`<a class="brand" href="#/">Mesa Tica</a>`);
  const { restaurant: r } = menu;
  patch(header, html`
    <a class="brand" href="#/">${r.name}</a><span class="descriptor">${r.descriptor}</span>
    <p class="state ${menu.open ? 'state-open' : 'state-closed'}">${menu.open ? 'Open now' : 'Closed'}</p>
    <dl class="facts">
      <div><dt>Hours</dt><dd>${r.hours}</dd></div>
      <div><dt>Pickup</dt><dd>${r.pickupLocation}</dd></div>
      <div><dt>Note</dt><dd>${r.customerNote}</dd></div>
    </dl>`);
}

function renderMenu() {
  patch(view, html`${menu.groups.map((group) => html`
    <section><h2>${group.name}</h2>
      <ul class="dishes">${group.items.map((item) => html`
        <li class="dish ${item.available ? '' : 'dish-out'}">
          <div><h3>${item.name}</h3><p>${item.description}</p></div>
          <div class="dish-side"><span class="price">${money(item.price)}</span>
            ${item.available ? '' : html`<span class="tag">Unavailable</span>`}</div>
        </li>`)}</ul>
    </section>`)}`);
}

const result = await api('/api/menu');
if (result.status === 200) {
  menu = result.data;
  renderHeader();
  renderMenu();
} else {
  patch(view, html`<p class="alert" role="alert">We couldn't load the menu. Check your connection and try again.</p>`);
}
