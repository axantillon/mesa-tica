// Application services: orchestration between controllers, policies and stores.

import { dateTimeLabel, hoursLabel, isOpen, nextOpening, timeLabel } from './policies.js';

export function createServices(stores, now) {
  const { restaurantStore, menuStore } = stores;

  const publicRestaurant = (r) => ({
    name: r.name,
    descriptor: r.descriptor,
    hours: hoursLabel(r),
    pickupLocation: r.pickupLocation,
    pickupInstructions: r.pickupInstructions,
    contact: r.contact,
    contactLabel: r.contactLabel,
    customerNote: r.customerNote,
  });

  const opening = (r, t) => {
    const open = isOpen(r, t);
    return { open, nextOpening: open ? null : nextOpening(r, t) };
  };

  const menuService = {
    getMenu() {
      const t = now();
      const restaurant = restaurantStore.read();
      const groups = [];
      for (const item of menuStore.readCurrent()) {
        let group = groups.find((g) => g.name === item.group);
        if (!group) groups.push(group = { name: item.group, items: [] });
        group.items.push(item);
      }
      return { restaurant: publicRestaurant(restaurant), ...opening(restaurant, t), groups, checked: timeLabel(t, restaurant.timezone) };
    },
  };

  return { menuService, dateTimeLabel };
}
