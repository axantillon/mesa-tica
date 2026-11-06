# Mesa Tica: build brief

Read this before you write code. Follow it to the end.

## 1. Goal and definition of done

Build Mesa Tica so all nine stories (A1–A3, B1–B3, C1–C3) work end to end in one running server. Maya orders on `/`. Luis moves the order on `/staff`. Helen sees it change on `/track/{token}`. The data survives a restart.

A story is done when its test passes and you saw it work over HTTP.

Not done: code that only compiles; stubs, TODOs, dead buttons; mocked or in-memory data paths.

## 2. Sources of truth

Authority: `diagrams/` > `context/one-pagers/` > this brief.

- `03-class.mmd`: exact class, method and attribute names, for code, tables and JSON keys. Do not rename them or add parameters.
- Sequences `A1`–`C3`: required behavior. Each `alt` and `loop` branch is a required path. `critical` is one `OrderStore.transaction`. Each `Note` is a rule.
- `diagrams/README.md`: each diagram's **Not drawn** list. Those details are required, like the drawn ones.
- `02-architecture.mmd`: the runtime elements. The API routes are in section 3. `01-context.mmd`: modules A ordering, B staff queue, C tracking, joined only by shared data. Group the code the same way.
- Conflict or gap: take the simplest choice that meets the one-pagers. Log it in `docs/decisions.md`: point, choice, why.

## 3. Fixed environment

- Node 24 (`"engines": {"node": "24.x"}`). Built-ins only: `node:http`, `node:sqlite` (`DatabaseSync`), `node:crypto`, `node:test`. No npm dependencies, no build step.
- Plain HTML, CSS and JavaScript from the same server: `/` (`MenuPage`, `Cart`), `/staff` (`StaffPage`), `/track/{token}` (`TrackingPage`).
- JSON API: only these routes, one per controller method in `03-class.mmd`. Codes: 401 no valid staff session; 404 unknown token or order; 409 stale version; 422 refused order or status change, with a reason code.

| Route | Controller method | Story |
|---|---|---|
| `GET /api/menu` | `OrderingController.getMenu()` | A1 |
| `POST /api/orders` | `OrderingController.placeOrder(submissionId, items)` | A3 |
| `POST /api/staff/sign-in` | `StaffController.signIn(username, password)` | B1 |
| `GET /api/staff/orders?status=` | `StaffController.listOrders(statusFilter)` | B1 |
| `GET /api/staff/orders/{number}` | `StaffController.getOrder(number)` | B2 |
| `POST /api/staff/orders/{number}/status` | `StaffController.changeStatus(number, version, to, reason)` | B3 |
| `GET /api/track/{token}` | `TrackingController.getTracking(token)` | C1–C3 |

| Variable | Default | Use |
|---|---|---|
| `PORT` | `3000` | Listen on `0.0.0.0:$PORT`. |
| `DATA_DIR` | `./data` | Holds `mesa.sqlite`. `/data` on Railway. |
| `STAFF_PASSWORD_LUIS`, `STAFF_PASSWORD_ELENA` | unset | Staff passwords for setup. |
| `TEST_NOW` | unset | Server clock start (ISO), for local checks outside opening hours. Never on Railway. |

- `npm run setup` runs the setup script: create the tables; add the restaurant, menu and staff only if missing; never overwrite. For an unset password variable, generate a password, print it once, and save it in `$DATA_DIR/staff-credentials.txt`.
- `npm start` runs the server. `npm test` runs `node --test`: offline, a temporary `DATA_DIR` per test.
- Railway: one service, a volume at `/data`, variables `DATA_DIR=/data` and both passwords, start command `npm run setup && npm start`. Railway sets `PORT`, runs in UTC, and puts HTTPS in front (`X-Forwarded-Proto: https`).

## 4. Seed data (fictional)

- Restaurant row (read by `RestaurantStore.readRestaurant()`): `name` Mesa Tica. `timeZone` `America/Costa_Rica` (UTC−6, no daylight saving). `weeklyHours`: every day, 10:00 inclusive to 21:00 exclusive.
- `collectionInstructions`: "Collect at the Mesa Tica pickup counter. Show your order number and pay at collection."
- `contact`: "demo-contact@example.invalid (Demo contact, not monitored)".
- Money: whole colones as integers, shown as ₡4,500. No taxes or fees.
- Staff accounts (read by `StaffStore.findEmployee(username)`): `luis` (Luis) and `elena` (Elena), same permissions. No orders at setup.

`Dish` rows, in this order:

| code | name | description | price | available |
|---|---|---|---:|---|
| M1 | Chicken casado | Rice, beans, chicken, salad and plantain. | 4500 | yes |
| M2 | Vegetarian casado | Rice, beans, vegetables, salad and plantain. | 4000 | yes |
| M3 | Fish casado | Rice, beans, fish and salad. | 5000 | no |
| S1 | Beef empanada | Corn pastry filled with seasoned beef. | 1500 | yes |
| S2 | Cheese empanada | Corn pastry filled with cheese. | 1400 | yes |
| S3 | Garden salad | Lettuce, tomato and cucumber. | 2500 | yes |
| S4 | Plantain side | Sweet fried plantain. | 1200 | yes |
| D1 | Horchata | Rice drink, 350 mL. | 1300 | yes |
| D2 | Iced tea | Unsweetened tea, 350 mL. | 1000 | yes |

Check values: 1 M1 + 1 S2 + 2 D2 = ₡7,900. Then D2 to 3: ₡8,900. Or remove S2: ₡6,500.

## 5. Work order

1. Data and setup: the three stores (`RestaurantStore`, `OrderStore` with `transaction`, `StaffStore`), the setup script, the page server.
2. Module A, then B, then C.
3. One test per story (section 6).
4. Run setup and start. Check every story over HTTP and on its page.
5. Fix until everything passes. Write the final output (section 8).

Keep going until every story passes. Do not stop at a plan, a partial build or a question.

## 6. Verification

Name each test after its story (`A3 place order`). Inject the clock. Write `Cart` and the polling state as DOM-free modules (storage passed in), so tests can load them.

| Story | The test proves |
|---|---|
| A1 | 9 dishes, all fields, M3 unavailable. Open at 10:00 and 20:59 Costa Rica time (16:00, 02:59 UTC). Closed at 09:59 and 21:00, with the next opening. |
| A2 | `setQuantity` refuses `0`, `-1`, `1.5`, `abc` and empty; cart unchanged. `remove` works. `total()` matches the check values. |
| A3 | A valid order: Received, unique number, 128-bit token. Resent, sent twice at once, resent after closing: same order, one row. Empty, bad quantity, closed (next opening), changed price, unavailable dish: 422, no order. A rejected `submissionId` resent after the fix is accepted. |
| B1 | Every staff route without a session: 401, no data. Wrong password refused. Oldest first. Each filter; default Received, Preparing, Ready. Polling state: a failure keeps the queue and warns; a success clears it. |
| B2 | Number, lines, quantities, `submittedAt`, status. Names and prices kept after a menu change. |
| B3 | Allowed moves work and record employee and time. Skips, backward moves, leaving Collected or Cancelled, a cancel without a reason: 422. Same version twice: one 200, one 409 with the current order. A retry on the new version works only if still valid. |
| C1 | Valid token: number and items, no staff names. Missing or unknown token, or an order number: 404, no data. |
| C2 | A staff change shows on the next `getTracking`. Polling state as in B1. |
| C3 | Ready: instructions, number. Cancelled: reason, contact. Received, Preparing: no instructions. |

Also: 100 mixed submissions give one order per accepted id. 100 same-version pairs give one success each. Data survives a restart.

Then start the server (set `TEST_NOW` outside opening hours). With curl or fetch: load the menu, place an order, resend it, sign in as `luis`, move it to Ready, read the tracking link after each step, cancel a second order with a reason. Open each page in a browser if you can; if not, fetch it and run `node --check` on its scripts.

Mark the speed, freshness and usability targets "not measured".

## 7. Rules and traps

- Never edit `diagrams/` or `context/`.
- Out of scope: online payment (pay at collection), holiday exceptions, scheduled orders, screens to edit the menu, hours or staff, customer accounts, recovering a lost link, app install, push notifications, preparation-time prediction, owner reporting and billing. No external services, CDN scripts or fonts.
- Money: integers. The server computes totals from the menu, not the browser.
- Time: open or closed comes from the server clock in `America/Costa_Rica`, not the browser or server zone. Store UTC; show Costa Rica time. Staff change statuses at any hour.
- `submissionId` is UNIQUE and the only retry key. `Cart.getSubmission()` makes it on the first Place order and keeps it until `Cart.clear()` after a confirmation. `findBySubmission` runs before `validate` (hours, quantities, prices, availability). A known id returns its order, whatever items arrive. Never store a rejection.
- A3 and B3 each run in one `OrderStore.transaction` (`BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK` on error), with no `await` inside.
- Quantities: `parseInt("1.5")` is 1. Check the whole string in `Cart`, and `Number.isInteger(q) && q > 0` on the server.
- `StaffPage` sends the version on screen when Luis acted. On 409 it shows the current order and why, and resends nothing.
- Polling: the next poll starts 2 s after the last ends. Over 5 s is a failure. A 401 shows sign-in. The queue sorts by `submittedAt`, then `number`.
- Tracking: the server returns `/track/{token}` (token: 16+ random bytes); the page adds `location.origin`. Copy link: `navigator.clipboard` needs HTTPS or localhost; otherwise show the link selected in a read-only field.
- Staff: `scrypt` with a salt, `timingSafeEqual`. Random session id from `StaffStore.createSession`, 12 hours. Cookie `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` behind HTTPS. Every `StaffController` method except `signIn` calls `StaffStore.findSession` first; no valid session: 401 and no data.
- Each entity in `03-class.mmd` is a table, plus the restaurant, staff account and session tables listed in `diagrams/README.md`. `OrderLine` and `StatusChange` are not JSON inside `Order`. `OrderLine` keeps the dish name and price at acceptance. Each staff change adds one `StatusChange`.
- Ignore the `node:sqlite` ExperimentalWarning. Git-ignore `data/`. Commit no passwords or tokens.
- An earlier run made these mistakes; do not repeat them: listening on `127.0.0.1`, extra routes and flags, Web Locks, passwords kept only on the volume, a browser downloaded by its tests, no Railway setup.

## 8. Final output

- `README.md`: run locally, deploy to Railway step by step, staff sign-in (usernames, where the passwords come from), tests.
- `docs/decisions.md`: every choice the design left open.
- `docs/story-status.md`, one row per story:

| Story | Status | Test name | Evidence |
|---|---|---|---|
| A1 | works / partly / missing | `A1 browse menu` | what you ran and saw |

- Closing message: the same table, then what is still missing.
