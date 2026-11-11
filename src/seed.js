// Supplied fictional sample content (context/restaurant-and-menu.md). Loaded only by setup.

const LUNCH_TO_DINNER = { open: 10 * 60, close: 21 * 60 }; // minutes after local midnight

export const RESTAURANT = {
  name: 'Mesa Tica',
  descriptor: 'Pickup ordering',
  timezone: 'America/Costa_Rica',
  currency: 'CRC',
  openingHours: Array(7).fill(LUNCH_TO_DINNER), // index 0 = Sunday; null = closed all day
  pickupLocation: 'Mesa Tica pickup counter',
  pickupInstructions: 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.',
  contact: 'demo-contact@example.invalid',
  contactLabel: 'Demo contact — not monitored.',
  customerNote: 'Pickup only. Pay at collection. Keep your tracking link private.',
};

export const MENU = [
  { id: 'M1', group: 'Meals', name: 'Chicken casado', description: 'Rice, beans, chicken, salad and plantain.', price: 4500, available: true },
  { id: 'M2', group: 'Meals', name: 'Vegetarian casado', description: 'Rice, beans, vegetables, salad and plantain.', price: 4000, available: true },
  { id: 'M3', group: 'Meals', name: 'Fish casado', description: 'Rice, beans, fish and salad.', price: 5000, available: false },
  { id: 'S1', group: 'Sides', name: 'Beef empanada', description: 'Corn pastry filled with seasoned beef.', price: 1500, available: true },
  { id: 'S2', group: 'Sides', name: 'Cheese empanada', description: 'Corn pastry filled with cheese.', price: 1400, available: true },
  { id: 'S3', group: 'Sides', name: 'Garden salad', description: 'Lettuce, tomato and cucumber.', price: 2500, available: true },
  { id: 'S4', group: 'Sides', name: 'Plantain side', description: 'Sweet fried plantain.', price: 1200, available: true },
  { id: 'D1', group: 'Drinks', name: 'Horchata', description: 'Rice drink, 350 mL.', price: 1300, available: true },
  { id: 'D2', group: 'Drinks', name: 'Iced tea', description: 'Unsweetened tea, 350 mL.', price: 1000, available: true },
];

export const STAFF = [
  { id: 'luis', username: 'luis', displayName: 'Luis' },
  { id: 'elena', username: 'elena', displayName: 'Elena' },
];
