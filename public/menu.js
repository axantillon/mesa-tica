const money = (amount) => '₡' + amount.toLocaleString('en-US');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function clock(time) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function openingText({ opening, restaurant }) {
  if (opening.open) return 'Open for pickup';
  if (!opening.next) return 'Ordering is closed. Contact: ' + restaurant.contact + ' · ' + restaurant.contactLabel;
  const date = new Date(opening.next.date + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return `Ordering is closed. Opens ${date} at ${clock(opening.next.time)} (Costa Rica time).`;
}

function renderMenu(dishes) {
  const menu = document.querySelector('#menu');
  menu.replaceChildren();
  if (!dishes.length) {
    menu.append(element('p', 'The menu is empty. Ordering is currently unavailable.', 'notice'));
    return;
  }
  for (const category of new Set(dishes.map((dish) => dish.category))) {
    const section = element('section', '', 'menu-group');
    section.append(element('h2', category));
    const list = element('ul', '', 'menu-list');
    for (const dish of dishes.filter((item) => item.category === category)) {
      const row = element('li', '', 'dish');
      const description = element('div');
      description.append(element('h3', dish.name), element('p', dish.description));
      const price = element('div', '', 'dish-actions');
      price.append(element('strong', money(dish.price)));
      if (!dish.available) price.append(element('span', 'Unavailable', 'badge'));
      row.append(description, price);
      list.append(row);
    }
    section.append(list);
    menu.append(section);
  }
}

try {
  const response = await fetch('/api/menu');
  if (!response.ok) throw new Error('Menu unavailable');
  const snapshot = await response.json();
  document.querySelector('#opening').textContent = openingText(snapshot);
  document.querySelector('#hours').textContent = 'Daily · 10:00 AM–9:00 PM · Costa Rica time';
  renderMenu(snapshot.menu);
} catch {
  document.querySelector('#opening').textContent = 'Ordering hours are unavailable.';
  document.querySelector('#menu').textContent = 'The menu could not load. Refresh this page to try again.';
}
