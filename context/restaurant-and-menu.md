# Restaurant identity and menu

This document supplies fictional sample restaurant content. Do not present it as a real operating business. Use the name Mesa Tica consistently; the product descriptor is Pickup ordering. Customer/staff interface language is English.

## Restaurant details

- Restaurant: Mesa Tica.
- Currency: Costa Rican colón (CRC). Display prices with the ₡ symbol and grouped thousands; the supplied prices are whole colones. Keep monetary calculations exact. No additional taxes or fees are added at checkout.
- Time zone: America/Costa_Rica.
- Hours: Monday through Sunday, 10:00 AM to 9:00 PM, restaurant-local time. At 9:00 PM new submissions are closed; an accepted submission can still be recovered and fulfilled.
- Pickup location: Mesa Tica pickup counter. This is a fictional demo location; do not invent a street address, map pin or directions to a real business.
- Pickup instructions: “Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.”
- Contact display: `demo-contact@example.invalid` — explicitly label “Demo contact — not monitored.” It is fictional placeholder contact information, not a working support channel. Do not invent a phone number or claim an email was sent.
- Customer note: “Pickup only. Pay at collection. Keep your tracking link private.”

## Menu

Prices below are colones. Menu codes are editorial labels. Images are not required and no image assets are supplied. Availability is a simple ordering flag, not a numeric stock count. Do not infer health, allergy or dietary safety claims from dish names/descriptions.

| Code | Group | Dish | Description | Price (CRC) | Availability |
|---|---|---|---|---:|---|
| M1 | Meals | Chicken casado | Rice, beans, chicken, salad and plantain. | 4,500 | Available |
| M2 | Meals | Vegetarian casado | Rice, beans, vegetables, salad and plantain. | 4,000 | Available |
| M3 | Meals | Fish casado | Rice, beans, fish and salad. | 5,000 | Unavailable |
| S1 | Sides | Beef empanada | Corn pastry filled with seasoned beef. | 1,500 | Available |
| S2 | Sides | Cheese empanada | Corn pastry filled with cheese. | 1,400 | Available |
| S3 | Sides | Garden salad | Lettuce, tomato and cucumber. | 2,500 | Available |
| S4 | Sides | Plantain side | Sweet fried plantain. | 1,200 | Available |
| D1 | Drinks | Horchata | Rice drink, 350 mL. | 1,300 | Available |
| D2 | Drinks | Iced tea | Unsweetened tea, 350 mL. | 1,000 | Available |

Within each group use the listed order; groups are Meals, Sides, Drinks. Unavailable Fish casado remains visible and marked Unavailable. The supplied descriptions contain no stock/availability wording so changing availability does not leave contradictory dish text.

## Product examples

These are worked acceptance examples, not a data format or preset customer orders:

- One Chicken casado + one Cheese empanada + two Iced teas = ₡7,900.
- Increase Iced tea from two to three in that cart: ₡8,900.
- Remove Cheese empanada from the original cart: ₡6,500.
- Change Chicken casado to ₡4,600 after the original cart was reviewed: require customer review; the revised original-cart total is ₡8,000. Do not accept the changed price silently.
- Try to add Fish casado: explain it is unavailable; no accepted order may contain it while unavailable.

The initial app has no customer orders. Sample orders are created through the normal ordering journey. Staff provisioning may use names Luis and Elena for distinguishable audit examples; usernames and credential setup are implementation choices. Both represent authorized restaurant employees with the same permissions, not separate roles.
