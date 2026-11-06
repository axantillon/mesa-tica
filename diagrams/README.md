# Mesa Tica diagrams

Twelve Mermaid diagrams: one context model, one architecture diagram, one class diagram, and one sequence diagram for each of the nine Project 1 stories. The stories and their requirements are in `../context/one-pagers/` (A, B and C).

How to read them:

- Every box in a sequence diagram, except the person on the left, is a class in `03-class.mmd` with the same name. Every call (solid arrow) is a method of that class, written exactly as in `03-class.mmd`. A person's action is written in words.
- A `critical` box is one database transaction, `OrderStore.transaction(work)`: the steps inside happen together or not at all.
- The pictures are kept small on purpose. Details that are not drawn are listed under **Not drawn** in each entry below. They are part of the design and are just as required as what is drawn.
- The letters A, B and C mark the three modules. They match the three one-pagers in every diagram.

## 01-context: context model

**What it shows.** The system boundary: one restaurant, pickup only. It has three modules: A customer ordering, B restaurant order queue, C order tracking. It shows who uses each module (Maya, Luis, Helen), the shared data that links them, the setup data supplied before use, and what is outside this release.

**Why it is valuable.** It fixes the scope before any detail: what we build, who uses it, and what we do not build.

**Covers.** All three one-pagers (A, B, C).

## 02-architecture: architecture diagram

**What it shows.** Every runtime element, top to bottom:

- **Front end.** The browser (phone, tablet or PC) shows three plain HTML and JavaScript pages: A menu page `/` with the cart, B staff page `/staff`, C tracking page `/track/{token}`. No install.
- **Back end.** One Node 24 server on Railway. It serves the pages and a JSON API through three controllers, one per module. The opening-hours rule lives in `OrderingController`, and the status-order rule lives in `StaffController`.
- **Data layer.** Three stores: `RestaurantStore`, `OrderStore`, `StaffStore`.
- **Data.** One SQLite file, `mesa.sqlite`, opened with Node's built-in `node:sqlite`, on a Railway persistent volume.
- **Setup script.** `npm run setup` fills the file once with the restaurant, the menu and the staff accounts.

**Not drawn.**

- The browser keeps two things. The cart and its `submissionId` are in localStorage. The staff session is an HttpOnly cookie.
- The staff page and the tracking page ask the server every 2 seconds. The menu page asks only when Maya acts.
- The server uses `node:http` only: no frameworks, no npm dependencies.
- There are no external services: no payment, email, SMS or push.
- The API routes, one per controller method, are listed in `prompts/one-shot-brief.md`, section 3.

**Why it is valuable.** It names what gets deployed and where the data lives, so the code has one clear shape and runs on Railway.

**Covers.** All stories.

## 03-class: class diagram

**What it shows.** The 14 classes the sequences use, grouped by module:

- **A ordering.** `MenuPage`, `Cart` and `OrderingController`.
- **C tracking.** `TrackingPage` and `TrackingController`.
- **B staff queue.** `StaffPage` and `StaffController`.
- **Shared database handlers.** `RestaurantStore`, `OrderStore` and `StaffStore`.
- **Saved data.** `Dish`, `Order`, `OrderLine` and `StatusChange`.

Each class lists only the methods the sequences call. C sits between A and B, so the shared `OrderStore` is in the middle and no lines cross.

**Not drawn.**

- **The page methods.** A person's actions (open the menu, place order, copy link, sign in, choose a filter, open an order, change a status) are handled by the page. The sequences write them in words.
- **`Cart.getSubmission()`.** It makes a random `submissionId` the first time Place order is pressed. The id is kept in localStorage with the items, and the items carry the prices Maya reviewed. It is cleared only by `clear()`, after a confirmation. While it is set, Place order sends the same id again, even after closing.
- **Order rules.**
  - `Order.submissionId` is unique: one order per submission.
  - `Order.trackingToken` is random, at least 128 bits.
  - `Order.status` is one of Received, Preparing, Ready, Collected, Cancelled.
  - `Order.version` goes up by 1 on every status change.
- **Order lines.** `OrderLine` keeps the dish name and price from the moment of acceptance, so an accepted order never changes when the menu changes. `createOrder` writes the lines and computes the total from the current menu prices.
- **Status changes.** `saveStatus` adds one `StatusChange` row with the employee and the time. On a cancel, it also sets `Order.cancellationReason`.
- **Staff sessions.** Every `StaffController` method except `signIn` reads the session id from the HttpOnly cookie and calls `StaffStore.findSession(sessionId)` first. No valid session: 401 and no data.
- **Transactions.** `OrderStore.transaction(work)` runs one SQLite transaction (`BEGIN IMMEDIATE` … `COMMIT`, `ROLLBACK` on error). A3 and B3 use it.
- **Setup data.** Three more tables hold the data that setup supplies. They are not drawn as classes because no story changes them:
  - The restaurant row: `name`, `timeZone`, `weeklyHours`, `collectionInstructions`, `contact`. `RestaurantStore.readRestaurant()` returns it. `readMenu()` returns the `Dish` rows.
  - The staff accounts: `id`, `username`, `name`, `passwordHash`. `StaffStore.findEmployee(username)` returns one.
  - The sessions: `id`, `employeeId`, `expiresAt`. `StaffStore.createSession(employeeId)` adds one, and `findSession` reads it.
- **One left-out arrow.** `TrackingController` also reads `RestaurantStore.readRestaurant()` (C3). That arrow is left out because it would cross `OrderingController → OrderStore`.

**Why it is valuable.** It is the one list of names every sequence uses, so the code can have one class or function for each. Controllers and database handlers are classes too, as the assignment asks.

**Covers.** All stories. Group A for A1–A3, group B for B1–B3, group C for C1–C3, and the shared handlers and saved data.

## A1-browse-menu

**What it shows.** Maya opens the menu. The server reads the dishes and the weekly hours. `openStatus(now)` decides open or closed. Each dish shows, and Add is off for unavailable dishes. Open: Place order is on. Closed: the next opening time, and Place order is off.

**Not drawn.**

- Each dish shows its name, description, price and availability.
- When closed, Maya can still browse and fill the cart.
- Only a submission already waiting for its answer can be resent after closing (see A3).

**Why it is valuable.** It shows where the open-or-closed decision comes from: the server clock in the restaurant's time zone, never the phone.

**Covers.** One-pager A, story A1.

## A2-edit-cart

**What it shows.** Maya adds a dish, changes a quantity or removes an item. The cart refuses 0, negative, fractional and non-numeric quantities, and Maya sees a correction message. The total is recalculated after every change.

**Not drawn.**

- A refused quantity leaves the cart unchanged.
- The cart checks the whole typed text, not only its first digits.

**Why it is valuable.** It puts quantity checking in one place, the `Cart`. It shows that the cart lives in the browser, so a reload keeps it.

**Covers.** One-pager A, story A2.

## A3-place-order

**What it shows.** Maya places her order with the `submissionId` the cart keeps. In one transaction the server first looks for an order with that id. Found: it is a retry, and the same order comes back, even after closing. New: `validate(items, now)` and then `createOrder`. Maya gets the order number, the tracking link, status Received and Copy link.

**Not drawn.**

- **What `validate` checks.** For a new id only:
  - the cart is not empty;
  - every quantity is a positive whole number;
  - the restaurant is open now (`openStatus(now)`);
  - every price and availability still matches `readMenu()`.
- **Refused.** 422 with the reason, and no order is created. Closed: the reason includes the next opening time. Changed prices or availability: the reason includes the current menu, the page calls `updatePrices(menu)`, and Maya reviews. The cart and its id are kept.
- **No answer.** The page says "not confirmed yet" and keeps the id. Place order sends the same id, and the server returns the same order.
- **Copy link.** It copies the link and confirms. If copying fails, the link is shown selected in a read-only field. A short tip says to paste the link into a note or bookmark the page.

**Why it is valuable.** It is the reliability rule: one order per submission, however many times the request is sent.

**Covers.** One-pager A, story A3.

## B1-view-queue

**What it shows.** Luis signs in with an account that setup created and gets a session cookie. Every 2 seconds the staff page asks for the queue with his filter. The server checks the session and lists the orders, oldest first. Answer arrives: the queue and the last refresh time. Offline: the last queue stays, with a stale-data warning.

**Not drawn.**

- A wrong username or password is refused with no data.
- The filter defaults to Received, Preparing and Ready, and it is kept across refreshes.
- After reconnection, the next answer refreshes the queue and clears the warning.
- There is no sign-up and no account screen.

**Why it is valuable.** It shows how staff access is checked on every request and how the queue stays fresh without any extra service.

**Covers.** One-pager B, story B1.

## B2-inspect-order

**What it shows.** Luis opens one order. After the session check, he sees its number, items, quantities and submission time. The names and prices come from the order lines saved at acceptance.

**Not drawn.** The current status and version are shown too. B3 needs the version.

**Why it is valuable.** It makes clear that an accepted order never changes when the menu changes.

**Covers.** One-pager B, story B2.

## B3-update-status

**What it shows.** Luis sends the next status, or Cancel with a reason, together with the version he saw. In one transaction the server reads the order.

- **Same version.** `canChange` checks the move, and `saveStatus` records it with his name.
- **Changed by someone else.** Luis gets one 409 with the current order. Nothing is saved, and nothing is resent automatically.

**Not drawn.**

- **Allowed moves.** Received → Preparing → Ready → Collected, or Cancel with a reason from Received, Preparing or Ready. Collected and Cancelled are final.
- **Refused moves.** `canChange` refuses everything else, including a cancel without a reason: 422 and nothing saved.
- **What `saveStatus` records.** The employee from the session and the time (one `StatusChange`). On a cancel, also the reason. The version goes up by 1.
- **Retrying.** If his change is still valid, Luis chooses it again. That is a new request with the new version.

**Why it is valuable.** It shows the single stale check that stops two employees from overwriting each other.

**Covers.** One-pager B, story B3.

## C1-open-tracking-link

**What it shows.** Helen opens her saved link. The server finds the order by its random token and returns its number and items. A missing or unknown token returns 404 and no order data.

**Not drawn.**

- No staff names are sent.
- An order number alone opens nothing.

**Why it is valuable.** It shows that the token is the only key to an order, which keeps every order private.

**Covers.** One-pager C, story C1.

## C2-follow-status

**What it shows.** The tracking page asks for the status every 2 seconds and shows the last successful check time. When a check fails, it shows an "updates unavailable" warning. The warning clears only after the next successful check.

**Not drawn.** A check that takes more than 5 seconds counts as failed.

**Why it is valuable.** Helen can never mistake an old status for the current one.

**Covers.** One-pager C, story C2.

## C3-ready-or-cancelled

**What it shows.** The tracking answer carries the status and the cancel reason from the order, plus the restaurant's collection instructions and contact.

- **Ready.** The collection instructions and the order number.
- **Cancelled.** The staff reason and the restaurant contact, so Helen can make other arrangements.

**Not drawn.**

- Received or Preparing: not ready yet, no collection instructions.
- Collected: nothing left to do.
- Payment is at collection.

**Why it is valuable.** It shows which data each status needs and where that data comes from.

**Covers.** One-pager C, story C3.
