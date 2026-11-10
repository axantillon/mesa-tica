import { describeHours, isOpen, nextOpening } from '../policies/opening-policy.js';

export function publicRestaurant(restaurant) {
  const { name, descriptor, timezone, timezoneLabel, pickupLocation, pickupInstructions, contact, contactLabel, customerNote, demoNotice } =
    restaurant;
  return { name, descriptor, timezone, timezoneLabel, pickupLocation, pickupInstructions, contact, contactLabel, customerNote, demoNotice };
}

/** Closed-state guidance: the next local opening, or contact details when the schedule has no opening. */
export function closedGuidance(restaurant, now) {
  const upcoming = nextOpening(restaurant, now);
  return {
    nextOpening: upcoming,
    message: upcoming
      ? `Ordering is closed. Opens ${upcoming.label}.`
      : `Ordering is closed. The restaurant is currently closed and has no upcoming opening hours. Contact ${restaurant.contact} (${restaurant.contactLabel}).`,
  };
}

/** MenuService: menu presentation with opening state; groups keep the configured dish order. */
export function createMenuService({ menuStore, restaurantStore }) {
  return {
    getMenu(now) {
      const restaurant = restaurantStore.readRestaurant();
      const items = menuStore.readCurrentMenu();
      const open = isOpen(restaurant, now);

      const groups = [];
      for (const item of items) {
        let group = groups.find((existing) => existing.name === item.group);
        if (!group) groups.push((group = { name: item.group, items: [] }));
        group.items.push({
          code: item.code,
          name: item.name,
          description: item.description,
          price: item.price,
          available: item.available,
        });
      }

      let ordering;
      if (items.length === 0) {
        ordering = { open, acceptingOrders: false, message: 'Ordering is unavailable right now because the menu has no dishes.' };
      } else if (!open) {
        ordering = { open, acceptingOrders: false, ...closedGuidance(restaurant, now) };
      } else {
        ordering = { open, acceptingOrders: true, message: 'Open now. Orders are prepared for pickup.' };
      }

      return { restaurant: publicRestaurant(restaurant), hours: describeHours(restaurant), ordering, groups };
    },
  };
}
