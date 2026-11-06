# Decisions

Details the diagrams leave open, with the choice made and why. Each is the simplest choice I found that still meets the one-pagers.

## Code and data

| Point | Choice | Why |
|---|---|---|
| Code layout | Folders by module: `a-ordering/`, `b-staff/`, `c-tracking/`, plus `shared/` (the stores, the polling state, page helpers) and `server.js`, `setup.js` at the root. Each controller, page and the `Cart` is one file named after its class. | `01-context` joins A, B and C only through shared data. The folders follow the same split. |
| Table names | Same names as the classes: `Dish`, `"Order"` (quoted, because ORDER is an SQL keyword), `OrderLine`, `StatusChange`, plus `Restaurant`, `StaffAccount` and `Session` for the setup data. Column names match the attributes. | The brief asks for the names in `03-class.mmd`. |
| Columns not in the class diagram | `OrderLine.orderNumber` and `StatusChange.orderNumber` (foreign keys), and an `id` row number on both. | The composition `Order *-- OrderLine` needs a link. `id` keeps lines and history in the order they were written. |
| Menu order | Dishes come back in the order setup inserts them (SQLite `rowid`), with no sort column. | The seed table gives the order. No story changes it. |
| `weeklyHours` | JSON text in the restaurant row: an array of 7 entries, index 0 = Sunday, each `{ "open": "10:00", "close": "21:00" }` or `null` for a closed day. | Readable, one row, no extra table. Hours past midnight are not supported. The seed doesn't need them. |
| Staff `id` | The username (`luis`, `elena`). `StatusChange.employeeId` stores it. | Readable history with no lookup. |
| Order `number` | `INTEGER PRIMARY KEY AUTOINCREMENT`, starting at 1. | Unique, never reused, short to say at the counter. |
| Tracking token | 16 random bytes (128 bits) from `node:crypto`, base64url (22 characters). | Meets "at least 128 bits" with the shortest URL. |
| `version` | Starts at 1 and goes up by 1 on each staff change. | The design says "goes up by 1". It has to start somewhere. |
| Creating an order is not a `StatusChange` | Only staff changes add a row. | "Each staff change adds one `StatusChange`". `submittedAt` already records the creation. |
| Schema creation | `openDatabase` runs `CREATE TABLE IF NOT EXISTS` every time it opens the file. The server also refuses to start if there is no restaurant row, and says to run `npm run setup`. | One place for the schema. A missing setup fails loudly instead of serving an empty menu. |

## A · Ordering

| Point | Choice | Why |
|---|---|---|
| `openStatus(now)` result | `{ open, nextOpening }`. `nextOpening` is a UTC ISO instant, or `null` when open. It looks up to 7 days ahead. | Store UTC, show Costa Rica time. Pages format it. |
| Local time | `Intl.DateTimeFormat` with the restaurant's `timeZone`. Never the server's or the browser's zone. | Railway runs in UTC. The rule must not depend on it. |
| Times shown on pages | Formatted with `timeZone: 'America/Costa_Rica'` (a constant in `shared/ui.js`, the same value as the seed). | The route list is fixed, so there's no route that hands the zone to the staff or tracking pages. The constant only affects display: open or closed is decided on the server. |
| Money | Whole colones everywhere. Shown as `₡4,500` (`en-US` digit grouping). | Seed and brief. |
| Language | English UI. | The one-pagers are in English. |
| Quantity upper limit | 1 to 99 per line, in `Cart.setQuantity` and in `validate`. | `Number.isInteger(1e300)` is true. Without a cap, a hand-made request could overflow the total. 99 is far above any pickup order. |
| Quantity input | `<input type="text" inputmode="numeric">`, and the cart checks the whole text against `^[0-9]+$`. | `type="number"` hides typed text like "abc" (its value becomes empty) and accepts "1.5". |
| `submissionId` | The cart makes 32 hex characters with `crypto.getRandomValues`. The server accepts 8–100 characters of `[A-Za-z0-9_-]`. Anything else: 422 `bad_submission`. | `crypto.randomUUID` only exists on HTTPS or localhost. `getRandomValues` works everywhere. The server checks the shape before using the id as a key. |
| `placeOrder` answers | 201 for a new order, 200 for a known `submissionId`. Both carry `{ number, status, submittedAt, total, lines, trackingLink }`. | Tests and logs can tell a retry from a new order. `lines` lets Maya see what was actually accepted, which matters when a retry returns an earlier order. |
| Retry after a status change | A known `submissionId` returns the order with its current status (for example Preparing or Cancelled), not a frozen "Received". The confirmation heading is just "Order #N". | Showing an old status would be false. |
| Refusal codes (422) | `empty`, `bad_quantity`, `closed` (+ `nextOpening`), `menu_changed` (+ `menu`, the current dishes), `bad_submission`. Checked in that order. | The brief asks for a reason code. |
| `menu_changed` | One code for a changed price, a dish that is now unavailable, and an unknown dish code. | The page does the same thing in all three cases: `updatePrices(menu)`, then Maya reviews. |
| `Cart.updatePrices(menu)` | Takes the new price and name. Removes dishes that are missing or unavailable. Returns the list of changes, so the page can say what changed. | Keeping an unavailable dish would only cause another refusal. |
| Prices on menu load | The page also calls `updatePrices` each time the menu loads, and says what changed. | A cart kept in localStorage since yesterday would otherwise show old prices until a refusal. |
| When the menu page asks the server | On open, when Maya comes back to the tab (`visibilitychange`), and when she presses Place order. No polling. | "The menu page asks only when Maya acts". Coming back to the tab is an act and refreshes open or closed. |
| Place order button | On when the cart is not empty and either the restaurant is open, or the cart holds a `submissionId` that has had no definite answer on this page. A 422 counts as a definite answer, so while closed the button goes off again. | "Only a submission already waiting for its answer can be resent after closing". |
| No answer | Timeout 15 s, network error or 5xx: "Not confirmed yet", and the cart and id are kept. | A 5xx rolled back, so resending the same id is safe. |
| Duplicate dish codes in one request | Accepted as separate lines. | `Cart` never sends them, and they do no harm. |
| Copy link | The confirmation always shows the link as a normal anchor. Copy link uses `navigator.clipboard`. If that fails, the link is shown selected in a read-only field. A tip says to paste it in a note or bookmark it. | A3. The anchor also lets Maya open the tracking page right away. |

## B · Staff queue

| Point | Choice | Why |
|---|---|---|
| Passwords | `scrypt` (64-byte key, 16-byte random salt), stored as `scrypt:<salt>:<hash>`, compared with `timingSafeEqual`. For an unknown username, scrypt still runs once against a dummy hash. | Brief. The dummy run keeps a wrong username from answering faster than a wrong password. |
| Sign-in failure | 401 `bad_credentials`, the same for a wrong user or a wrong password, and no cookie. | 401 is "no valid staff session". Giving no hint about which part was wrong is standard. |
| Session cookie | `mesa_session=<32 random bytes, base64url>; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`, plus `Secure` when `X-Forwarded-Proto: https`. | Brief. `Max-Age` matches the 12-hour session. |
| How `StaffController` gets the session | The server makes one `StaffController` per request, passing the cookie's session id to the constructor. The methods keep the exact parameters from `03-class`. | The class diagram allows no extra parameters. |
| Sign out | None. Sessions end after 12 hours. Expired rows are not deleted. | The route list is fixed and has no sign-out route. |
| `listOrders(statusFilter)` | `?status=Received,Preparing` (comma-separated). Missing or empty means the default Received, Preparing, Ready. An unknown status gives 422 `bad_filter`. Each order carries its lines, so the queue can show an item summary. | Simple query string. The summary helps Luis plan the kitchen (B1's "so that"). |
| Filter on the page | Checkboxes, kept in memory across refreshes. At least one stays checked. A change triggers a refresh right away. | An empty filter would silently mean "default". |
| Staff order JSON | `{ order: { number, submittedAt, status, version, total, cancellationReason, lines, statusChanges } }`. It never includes `submissionId` or `trackingToken`. | B2 needs the version. The history shows B3's "record the employee and timestamp". The token is only the customer's. |
| Stale check | `version` must be exactly equal (`===`) to the stored version. Any other value, wrong type included, gets 409 with the current order. | One rule, no special cases. |
| `canChange` codes (422) | `unknown_status`, `final_status` (from Collected or Cancelled), `reason_required` (empty or only spaces), `reason_too_long` (over 500 characters), `not_next_status`. The 422 body also carries the current order. | The brief asks for a reason code. |
| Cancel reason | Trimmed and stored on `Order.cancellationReason` and on that `StatusChange.reason`. Ignored for other moves (stored as null). | The customer sees it. Spaces alone are not a reason. |
| Detail panel refresh | The open order does not refresh by itself. When the queue shows a newer version, the panel says "This order changed since you opened it", with a "Show the latest" button. | The version on screen must be the one Luis saw when he acted. Swapping the buttons under his finger could make him press the wrong one. |
| 409 on the page | It shows the current order and who made the last change, and when. It says nothing was resent. The buttons now use the new version, so choosing again is a deliberate retry. | B3. |
| No answer to a change | "The change may not be saved. Check the queue." Nothing is resent. | A resend on the old version would get a 409 anyway, but the page never resends on its own. |

## C · Tracking

| Point | Choice | Why |
|---|---|---|
| Tracking JSON | `{ number, status, submittedAt, total, lines }`. `collectionInstructions` is added only when Ready. `cancellationReason` and `contact` are added only when Cancelled. No staff ids, no version, no history. | C1 and C3, and the brief's C3 test ("Received, Preparing: no instructions"). |
| Not found | `/api/track/{anything unknown}` gives 404 `{ "reason": "not_found" }`. An order number is just an unknown token. The `/track/{token}` HTML page is always served (it holds no data) and shows "Link not valid" after the 404. | C1. |
| Polling end | The tracking page stops asking once the order is Collected or Cancelled, and says "Final status". A 404 also stops it. | Nothing can change after a final status. |
| Stale status | During a failure the status is dimmed, and the banner says "Updates unavailable", with the last successful check time. A screen-reader live region announces status changes and lost or restored updates. | C2: Helen must not mistake an old status for the current one. |

## Shared

| Point | Choice | Why |
|---|---|---|
| Polling state | One DOM-free `Poller` class (`shared/Poller.js`) for B1 and C2. The next poll starts 2 s after the last one ends. A poll over 5 s is aborted and counts as a failure. A failure keeps the data and sets `warning`. Only a success clears it. A 401 (staff) or 404 (tracking) stops polling. | The brief's polling rules, written once. |
| Error and other codes | 401 `not_signed_in` / `bad_credentials`, 404 `not_found`, 409 `stale_version`, 422 as listed above, 500 `server_error`. A body that is not a JSON object, or is over 64 KB, is treated as `{}`, so the normal 401 or 422 applies. | The brief's code list has no 400. |
| Served files | Only a fixed list: the three pages, their scripts and one stylesheet. Server code and the data folder are never served. | Least exposure. |
| Security headers | `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. API answers are `Cache-Control: no-store`. | No external scripts. No framing of the staff page. Tracking tokens in URLs must not leak through the Referer header. |
| `TEST_NOW` | The server clock starts at `TEST_NOW` and then runs normally. Times measured in the browser (last refresh, last check) use the browser's clock. | Brief. Those two times are about the viewer's connection, not the restaurant. |
| Setup | `INSERT OR IGNORE` for the restaurant and dishes. Staff accounts are added only if the username is missing. A missing password variable gets 12 random bytes (base64url), printed once and appended to `$DATA_DIR/staff-credentials.txt` (mode 600). An existing account is never changed, even if the variable changes later. | "Add only if missing; never overwrite". |
| Railway | `railway.json` sets the start command `npm run setup && npm start`, health check `/api/menu`, restart on failure. The volume and variables are set in the Railway dashboard (see README). One replica only. | SQLite on a volume is a single-writer file. |
| Tests | `node --test` with no dependencies. Each test file starts real servers on temporary data folders with an injected clock. | Brief. |
