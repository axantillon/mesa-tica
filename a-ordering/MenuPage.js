// A · MenuPage: the menu (A1), the cart (A2) and Place order with Copy link (A3).
import { Cart, MAX_QUANTITY } from './Cart.js';
import { money, dateTime, h, api } from '../shared/ui.js';

const REFUSALS = {
  empty: 'Your cart is empty. Add a dish first.',
  bad_quantity: `Each quantity must be a whole number from 1 to ${MAX_QUANTITY}.`,
  bad_submission: 'Something went wrong with this order. Reload the page and try again.',
};
const describeChanges = (changes) =>
  changes
    .map((c) => (c.removed ? `${c.name} is no longer available and was removed.` : `${c.name} is now ${money(c.to)} (was ${money(c.from)}).`))
    .join(' ');

class MenuPage {
  constructor() {
    this.cart = new Cart(localStorage);
    this.dishes = [];
    this.open = false;
    this.nextOpening = null;
    this.loaded = false;
    this.sending = false;
    this.answered = false; // the kept submission got a definite answer (a refusal) on this page
    this.message = null;
    this.itemErrors = {};
  }

  // getMenu(): asked when the page opens, and again when Maya comes back to it.
  async load() {
    try {
      const { status, body } = await api('/api/menu', { signal: AbortSignal.timeout(10000) });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      Object.assign(this, { dishes: body.dishes, open: body.open, nextOpening: body.nextOpening, loaded: true });
      const changes = this.cart.updatePrices(body.dishes);
      if (changes.length) this.message = { kind: 'warn', text: `Your cart was updated to today's menu. ${describeChanges(changes)}` };
    } catch {
      if (!this.loaded) document.getElementById('hours').textContent = 'The menu could not load. Check your connection and reload the page.';
      return;
    }
    this.render();
  }

  render() {
    this.renderHours();
    this.renderDishes();
    this.renderCart();
  }

  renderHours() {
    const el = document.getElementById('hours');
    el.className = `banner ${this.open ? 'ok' : 'warn'}`;
    el.textContent = this.open
      ? 'Open now. Place your order and collect it at the counter.'
      : `Closed now. We open ${this.nextOpening ? dateTime(this.nextOpening) : 'soon'} (Costa Rica time). You can still browse and fill your cart.`;
  }

  renderDishes() {
    document.getElementById('dishes').replaceChildren(
      ...this.dishes.map((d) =>
        h('li', { class: d.available ? 'dish' : 'dish unavailable' },
          h('div', {}, h('h3', {}, d.name), h('p', {}, d.description), !d.available && h('p', { class: 'tag' }, 'Not available today')),
          h('div', { class: 'buy' },
            h('span', { class: 'price' }, money(d.price)),
            h('button', { type: 'button', disabled: !d.available, onclick: () => this.add(d), 'aria-label': `Add ${d.name}` }, 'Add'),
          ),
        ),
      ),
    );
  }

  renderCart() {
    const items = this.cart.items;
    const pending = Boolean(this.cart.submissionId);
    const canPlace = items.length > 0 && !this.sending && (this.open || (pending && !this.answered));
    document.getElementById('cart-body').replaceChildren(
      items.length === 0
        ? h('p', { class: 'muted' }, 'Your cart is empty.')
        : h('ul', { class: 'lines' },
          items.map((i) =>
            h('li', {},
              h('span', { class: 'line-name' }, i.name, h('small', {}, ` ${money(i.price)} each`)),
              h('input', {
                type: 'text', inputmode: 'numeric', value: String(i.quantity), class: 'qty', 'aria-label': `Quantity of ${i.name}`,
                onchange: (e) => this.setQuantity(i.code, e.target.value),
              }),
              h('span', { class: 'line-total' }, money(i.price * i.quantity)),
              h('button', { type: 'button', class: 'link', onclick: () => this.remove(i.code) }, 'Remove'),
              this.itemErrors[i.code] && h('p', { class: 'error line-error', role: 'alert' }, this.itemErrors[i.code]),
            ),
          ),
        ),
      h('p', { class: 'total' }, 'Total ', h('strong', {}, money(this.cart.total()))),
      h('p', { class: 'muted' }, 'Prices include taxes. No extra fees. Pay at collection.'),
      this.message && h('p', { class: this.message.kind, role: 'alert' }, this.message.text),
      h('button', { type: 'button', class: 'primary', disabled: !canPlace, onclick: () => this.placeOrder() }, this.sending ? 'Sending…' : 'Place order'),
      !this.open && items.length > 0 && !canPlace && !this.sending && h('p', { class: 'muted' }, 'Place order turns on when we open.'),
    );
  }

  add(dish) {
    document.getElementById('confirmation').hidden = true;
    this.message = this.cart.add(dish) ? null : { kind: 'error', text: `You can order at most ${MAX_QUANTITY} of one dish.` };
    this.renderCart();
  }

  setQuantity(code, text) {
    if (this.cart.setQuantity(code, text)) delete this.itemErrors[code];
    else this.itemErrors[code] = `"${text}" is not a quantity. Enter a whole number from 1 to ${MAX_QUANTITY}.`;
    this.renderCart();
  }

  remove(code) {
    this.cart.remove(code);
    delete this.itemErrors[code];
    this.renderCart();
  }

  async placeOrder() {
    const { submissionId, items } = this.cart.getSubmission();
    this.sending = true;
    this.message = null;
    this.renderCart();
    let result = null;
    try {
      result = await api('/api/orders', { method: 'POST', body: { submissionId, items }, signal: AbortSignal.timeout(15000) });
    } catch {}
    this.sending = false;
    if (result?.status === 200 || result?.status === 201) {
      this.cart.clear();
      this.itemErrors = {};
      this.answered = false;
      this.showConfirmation(result.body);
    } else if (result?.status === 422) {
      this.answered = true;
      this.refused(result.body);
    } else {
      this.answered = false;
      this.message = {
        kind: 'warn',
        text: 'Not confirmed yet: no answer from the restaurant. Your cart is kept. Press Place order again. It resends the same order, so it cannot be placed twice.',
      };
    }
    this.render();
  }

  // 422: no order was made. The cart and its submissionId are kept.
  refused(body) {
    if (body.reason === 'closed') {
      Object.assign(this, { open: false, nextOpening: body.nextOpening });
      this.message = { kind: 'warn', text: `We are closed, so the order was not placed. We open ${dateTime(body.nextOpening)} (Costa Rica time). Your cart is kept.` };
    } else if (body.reason === 'menu_changed') {
      this.dishes = body.menu;
      const changes = this.cart.updatePrices(body.menu);
      this.message = { kind: 'warn', text: `The order was not placed because the menu changed. ${describeChanges(changes)} Please review your order, then press Place order again.` };
    } else {
      this.message = { kind: 'error', text: REFUSALS[body.reason] ?? 'The order was not placed. Please review your cart and try again.' };
    }
  }

  showConfirmation(order) {
    const url = location.origin + order.trackingLink;
    const field = h('input', { type: 'text', readonly: true, value: url, class: 'link-field', hidden: true, 'aria-label': 'Tracking link' });
    const feedback = h('p', { class: 'ok', role: 'status' });
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(url); // needs HTTPS or localhost
        feedback.textContent = 'Link copied. Paste it somewhere safe.';
        field.hidden = true;
      } catch {
        field.hidden = false;
        field.focus();
        field.select();
        feedback.textContent = 'Copying is not available here. The link is selected in the box below: copy it from there.';
      }
    };
    const el = document.getElementById('confirmation');
    el.replaceChildren(
      h('h2', {}, `Order #${order.number} received`),
      h('p', {}, 'Status: ', h('strong', {}, order.status), ` · sent ${dateTime(order.submittedAt)}`),
      h('ul', { class: 'lines' }, order.lines.map((l) => h('li', {}, `${l.quantity} × ${l.dishName}`, h('span', { class: 'line-total' }, money(l.price * l.quantity))))),
      h('p', { class: 'total' }, 'Total ', h('strong', {}, money(order.total)), ' · pay at collection'),
      h('p', {}, 'Your private tracking link: ', h('a', { href: order.trackingLink }, url)),
      h('button', { type: 'button', class: 'primary', onclick: copy }, 'Copy link'),
      feedback,
      field,
      h('p', { class: 'tip' }, 'Tip: paste the link into a note, or bookmark the tracking page, so you can check your order later.'),
    );
    el.hidden = false;
    el.scrollIntoView({ block: 'start' });
  }
}

const page = new MenuPage();
page.load();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') page.load();
});
