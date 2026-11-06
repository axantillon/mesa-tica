// A · Cart: kept in storage (localStorage in the browser). DOM-free so tests can load it.
export const MAX_QUANTITY = 99;
const WHOLE_NUMBER = /^[0-9]+$/;

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // works on plain HTTP too, unlike randomUUID
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Cart {
  constructor(storage, key = 'mesaTica.cart') {
    this.storage = storage;
    this.key = key;
    let saved = null;
    try {
      saved = JSON.parse(storage.getItem(key));
    } catch {}
    this.items = Array.isArray(saved?.items) ? saved.items : [];
    this.submissionId = typeof saved?.submissionId === 'string' ? saved.submissionId : null;
  }

  #save() {
    this.storage.setItem(this.key, JSON.stringify({ items: this.items, submissionId: this.submissionId }));
  }

  add(dish) {
    if (!dish.available) return false;
    const item = this.items.find((i) => i.code === dish.code);
    if (item && item.quantity >= MAX_QUANTITY) return false;
    if (item) item.quantity += 1;
    else this.items.push({ code: dish.code, name: dish.name, price: dish.price, quantity: 1 });
    this.#save();
    return true;
  }

  // Checks the whole typed text: "1.5", "-1", "0", "abc" and "" are refused and the cart is unchanged.
  setQuantity(dishCode, quantity) {
    const text = String(quantity ?? '').trim();
    const item = this.items.find((i) => i.code === dishCode);
    const n = Number(text);
    if (!item || !WHOLE_NUMBER.test(text) || n < 1 || n > MAX_QUANTITY) return false;
    item.quantity = n;
    this.#save();
    return true;
  }

  remove(dishCode) {
    this.items = this.items.filter((i) => i.code !== dishCode);
    this.#save();
  }

  total() {
    return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  }

  // Made on the first Place order and kept until clear(), so every resend uses the same id.
  getSubmission() {
    if (!this.submissionId) {
      this.submissionId = randomId();
      this.#save();
    }
    return {
      submissionId: this.submissionId,
      items: this.items.map(({ code, price, quantity }) => ({ code, price, quantity })),
    };
  }

  // Takes the current menu: new prices and names, and drops dishes no longer available. Returns what changed.
  updatePrices(menu) {
    const byCode = new Map(menu.map((d) => [d.code, d]));
    const changes = [];
    this.items = this.items.filter((item) => {
      const dish = byCode.get(item.code);
      if (!dish || !dish.available) {
        changes.push({ name: item.name, removed: true });
        return false;
      }
      if (dish.price !== item.price) changes.push({ name: dish.name, from: item.price, to: dish.price });
      item.price = dish.price;
      item.name = dish.name;
      return true;
    });
    this.#save();
    return changes;
  }

  clear() {
    this.items = [];
    this.submissionId = null;
    this.#save();
  }
}
