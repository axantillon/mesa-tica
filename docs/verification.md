# Verification

Verified locally on November 5, 2026 with Node 24.18.0, SQLite 3.53.2 and Playwright CLI 0.1.23 running Chromium 157 on macOS. The automated suites used independent temporary databases. The browser suite used an open test clock, phone and tablet viewports, and request interception to exercise unreachable reads and dropped acknowledgments. The ordinary server uses real restaurant-local time.

## Commands and evidence

| Command | Observed result |
| --- | --- |
| `npm run setup` twice, then `npm start` | Setup provisioned two distinguishable employees and nine dishes with zero orders. The credentials file was mode 0600. The final application bound to `127.0.0.1:3000`. |
| Loopback HTTP smoke against port 3000 | Menu and staff pages returned 200. Each generated credential signed in, loaded the empty Active queue and signed out. The demo database remained order-free. |
| `npm test` | Three passing HTTP suites. They cover guest checkout, staff and tracking behavior across a restart, 100 mixed submissions and 100 pairs of competing staff changes. [Checkout](../test/checkout.test.js) · [Staff](../test/staff.test.js) · [Consistency](../test/consistency.test.js) |
| `npx --yes --package @playwright/cli@0.1.23 playwright-cli install-browser chromium`, then `npm run test:browser` | Seven browser groups passed. The app was exercised through its UI, including the system clipboard success path, forced copy failure, lost acceptance and write responses, concurrent staff changes and polling recovery. [Browser scenario](../verification/browser-scenario.js) |
| `git diff --check` | No whitespace errors in the implementation diff. |

The first browser run found that the mobile cart shortcut scrolled to the cart while leaving keyboard focus outside it. The shortcut now focuses the cart heading and scrolls it into view. The browser regression check passed. The 390 × 844 menu was also visually inspected in Chromium.

## Acceptance results

| ID | Result | Evidence |
| --- | --- | --- |
| SETUP | PASS | Two setup runs preserved configuration and credentials. The isolated staff suite stopped and restarted the server and read the same accepted contents, history and private tracking. |
| A1 | PASS | HTTP verified nine dishes, Fish casado rejection, inclusive opening and exclusive closing in the Costa Rica zone, next date and no-upcoming-opening result. Chromium verified disabled placement and usable Add/Remove controls with the closed menu state. |
| A2 | PASS | Chromium verified repeat Add, ₡7,900 / ₡8,900 / ₡6,500 totals, removal, empty-cart blocking, preserved valid selection after reload and correction for zero, negative, fractional and nonnumeric input. |
| A3 | PASS | The guest UI created a Received order without personal data or an account. HTTP verified the accepted snapshot and zero orders after empty, invalid, unavailable and closed requests. |
| A3-REVIEW | PASS | HTTP rejected increases, decreases and removed dishes without creating an order, and accepted a deliberate new attempt at the reviewed price. Chromium verified the cart retained unavailable items and required price review. |
| A4 | PASS | Chromium dropped a real acceptance response, retained the pending cart through reload and recovered the same order. HTTP verified simultaneous retries, after-close recovery, permanent rejection, scope isolation and a separate deliberate order. |
| A5 | PASS | Chromium verified received confirmation, clipboard success, selectable fallback, save/privacy guidance and the cleared cart. Recovering a cancelled order showed its progressed status and omitted the payment prompt. The renderer uses the same terminal-state payment rule for Collected. |
| B1 | PASS | HTTP verified oldest-first ordering with a tie-break and all filter values. Chromium verified generic credential rejection versus failed connection, empty Active, new orders without reload, return to the selected filter and sign-out. |
| B1-STALE | PASS | Chromium verified the last queue and successful time survive a failed fetch, a successful read clears the warning and expiry hides staff data. HTTP verified actual session expiry and sign-out revocation. |
| B2 | PASS | HTTP changed the menu and verified the accepted name, quantity, price, subtotal and time, then checked attributed history after restart. Chromium displayed accepted details and history. |
| B3 | PASS | HTTP verified legal transitions, skipped and terminal rejection, a required nonblank reason and explicit confirmation. Chromium verified dismissal with the reason retained and an uncertain write recovered through a read. |
| B3-CONFLICT | PASS | HTTP and Chromium used separate staff identities. One write won, the other got the current state and an explanation. In Chromium, the dialog held its original revision through a background refresh, kept the reason and required a fresh deliberate action. |
| C1 | PASS | Chromium opened a saved link in an independent guest context and verified a guessed number shows generic guidance. HTTP verified the scoped private projection and a 32-byte random token format. A failed first fetch showed an unavailable update, without an invented order or time. |
| C2 | PASS | Chromium observed automatic status changes, preserved stale Ready and its successful timestamp, then fetched Collected and cleared the warning. |
| C3 | PASS | Chromium and HTTP checked waiting instructions, Ready pickup/payment/location, Cancelled reason and labeled demo contact, and no pickup instruction after collection. The stale Ready warning asks the customer to check again before leaving. |
| ACCESS | PASS | HTTP denied anonymous staff reads and writes and a tracking token used as staff access. It verified customer tracking excluded staff identities and rejected a cross-origin browser write signal. |
| EXPERIENCE | PASS | Automated functional check in Chromium at 390 × 844 and 1024 × 768. The suite checked keyboard Add, focus at the cart shortcut, field corrections, no page overflow in core views and preserved dialog input during refresh. Physical-device and assistive-technology coverage remains open. |
| RUN | PASS | Documented setup and startup were exercised on loopback. Chromium completed guest ordering, staff fulfillment and customer progress. HTTP verified persistence across restart. Deployment prerequisites are documented separately. |

## Quality targets

| Target | Result | Conditions and outcome |
| --- | --- | --- |
| Menu load p95 with 100 customer sessions | UNRUN | Browser functional checks used individual sessions. No shaped-network load run. |
| Queue load and update p95 with 10 staff sessions and 200 active orders | UNRUN | Functional queue polling verified with two identities and a small queue. |
| Tracking update and recovery timing with 100 active sessions | UNRUN | Functional browser recovery verified in one tracking context. |
| 100 submission reliability cases | PASS | Isolated loopback HTTP test. 25 ordinary submissions, 25 simultaneous repeat sets, 25 discarded responses recovered at closing, and 25 definite rejections. Exactly 75 distinct accepted orders, 75 distinct links and 25 closed rejections. |
| 100 competing staff pairs | PASS | Two authenticated employees sent concurrent individually valid writes at the same revision for 100 isolated orders. All pairs returned one 200 and one 409. Each loser deliberately advanced against the current revision and history contained exactly two correctly attributed entries per order. |
| First-time human usability | UNRUN | Automated tests and a visual inspection used no study participants. |
| Live deployment and restore | UNRUN | The application was operated on loopback. HTTPS proxy, public reachability and backup restore were not exercised. |
