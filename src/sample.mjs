export const restaurant = {
  name: 'Mesa Tica', timezone: 'America/Costa_Rica', currency: 'CRC',
  hours: Array.from({ length: 7 }, () => [600, 1260]),
  pickupLocation: 'Mesa Tica pickup counter',
  pickupInstructions: 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.',
  contact: 'demo-contact@example.invalid',
};

export const menu = [
  ['M1', 'Meals', 'Chicken casado', 'Rice, beans, chicken, salad and plantain.', 4500, true],
  ['M2', 'Meals', 'Vegetarian casado', 'Rice, beans, vegetables, salad and plantain.', 4000, true],
  ['M3', 'Meals', 'Fish casado', 'Rice, beans, fish and salad.', 5000, false],
  ['S1', 'Sides', 'Beef empanada', 'Corn pastry filled with seasoned beef.', 1500, true],
  ['S2', 'Sides', 'Cheese empanada', 'Corn pastry filled with cheese.', 1400, true],
  ['S3', 'Sides', 'Garden salad', 'Lettuce, tomato and cucumber.', 2500, true],
  ['S4', 'Sides', 'Plantain side', 'Sweet fried plantain.', 1200, true],
  ['D1', 'Drinks', 'Horchata', 'Rice drink, 350 mL.', 1300, true],
  ['D2', 'Drinks', 'Iced tea', 'Unsweetened tea, 350 mL.', 1000, true],
].map(([id, group, name, description, price, available]) => ({ id, group, name, description, price, available }));
