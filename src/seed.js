export const restaurant = {
  name: 'Mesa Tica',
  timezone: 'America/Costa_Rica',
  currency: 'CRC',
  hours: Array.from({ length: 7 }, () => ['10:00', '21:00']),
  pickupLocation: 'Mesa Tica pickup counter',
  pickupInstructions: 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.',
  contact: 'demo-contact@example.invalid',
  contactLabel: 'Demo contact — not monitored',
};

export const dishes = [
  ['M1', 'Meals', 'Chicken casado', 'Rice, beans, chicken, salad and plantain.', 4500, 1],
  ['M2', 'Meals', 'Vegetarian casado', 'Rice, beans, vegetables, salad and plantain.', 4000, 1],
  ['M3', 'Meals', 'Fish casado', 'Rice, beans, fish and salad.', 5000, 0],
  ['S1', 'Sides', 'Beef empanada', 'Corn pastry filled with seasoned beef.', 1500, 1],
  ['S2', 'Sides', 'Cheese empanada', 'Corn pastry filled with cheese.', 1400, 1],
  ['S3', 'Sides', 'Garden salad', 'Lettuce, tomato and cucumber.', 2500, 1],
  ['S4', 'Sides', 'Plantain side', 'Sweet fried plantain.', 1200, 1],
  ['D1', 'Drinks', 'Horchata', 'Rice drink, 350 mL.', 1300, 1],
  ['D2', 'Drinks', 'Iced tea', 'Unsweetened tea, 350 mL.', 1000, 1],
];
