# Verification results

All results below are from automated runs on one development machine. **No live deployment and no human study was performed, and nothing here is real-user validation.**

## How it was run

- **Code under test:** the three test suites ran on a fresh `git clone` of this branch at `c697d3c`, with `npm ci`. Product code (`src/`, `public/`) has not changed since `85ed047`, the commit the `npm start` journey ran on. Measurements ran at `4254b24`, which differs from `c697d3c` only by one browser test.
- **Machine:** Apple M4 Pro, 14 cores, macOS, Node.js 24.5.0, Playwright 1.63 (Chromium and WebKit).
- **Date:** 2026-11-09 (UTC).
- **Isolation:** each test uses the real app on its own temporary data directory. Closed-hours and changed-menu cases use isolated data and a test-controlled clock, as `S1-setup.mmd` directs. Production code has no such hooks.

| Command | Outcome |
|---|---|
| `npm test` | 39 tests, 39 passed, 0 failed |
| `npm run test:e2e` (Chromium, including accessibility scan) | 55 tests, 55 passed, 0 failed |
| `E2E_BROWSER=webkit node --test --test-concurrency=1 --test-timeout=60000 test/e2e/customer.test.js test/e2e/staff.test.js test/e2e/tracking.test.js` (with `--disable-warning=ExperimentalWarning`) | 54 tests, 54 passed, 0 failed |
| `npm start` from an empty data directory, driven in a real browser | See RUN below |
| `npm run measure`, three runs | See quality targets below |
| Secret scan of `git log -p --all` against every generated password and tracking token | 0 matches; 0 `/track/<token>` URLs; no data, credential or database file tracked |

## Acceptance results

Test names are quoted from `test/*.test.js` and `test/e2e/*.test.js`.

| ID | Result | Evidence |
|---|---|---|
| SETUP | **PASS** | "SETUP is repeatable: no duplicate menu, no password reset, no customer orders"; "SETUP does not re-add a dish the operator removed"; "SETUP orders, status, history, sessions and private links survive a restart". Two distinct accounts generated. |
| A1 | **PASS** | "A1 opening is inclusive, closing exclusive" checks 9:59:59, 10:00:00, 20:59:59 and 21:00:00 local. Browser: dishes, prices and Fish casado with no Add action; closed browsing with next opening; no-upcoming-opening contact; empty menu; failed load. |
| A2 | **PASS** | "A2 worked totals" gives ₡7,900, ₡8,900 and ₡6,500. "A2 invalid quantities" covers `0`, `-1`, `1.5`, `abc` and blank, each corrected with the row and last valid total kept. Also focus while typing, reload persistence and corrupted storage. |
| A3 | **PASS** | "A3 a valid guest order…"; "A3 empty, invalid and closed submissions are rejected without creating an order"; acceptance-boundary test; repeated-tap test gives one order; no personal-information fields present. |
| A3-REVIEW | **PASS** | Price changes in both directions and ₡8,000 revised total; fresh submit required; unavailable and removed dishes stay identified; the button is held until the re-check finishes; cart retained. |
| A4 | **PASS** | 25 simultaneous submissions give one order; lost confirmation recovered, including after closing and a menu change; rejection stays rejected on retry; scoped to customer; deliberate new order separate. Browser: honest uncertain wording, cart locked, recovery after reload. Also 50 rounds across two server processes sharing one database. |
| A5 | **PASS** | "A3/A5 a guest places an order…" covers number, items, total, payment and save guidance, cart cleared, "Link copied" (clipboard content read back on Chromium). "A5 a failed copy offers a selectable link". Recovered Cancelled and Collected orders omit payment; progressed orders are not reset to Received. |
| B1 | **PASS** | Sign-in and sign-out; generic failure identical for unknown accounts; sign-in limit; connection failure not blamed on credentials; oldest-first with tie-break; all seven filters; automatic new orders and other-employee changes; filter kept on return; empty and failed states distinct. |
| B1-STALE | **PASS** | "B1-STALE a refresh failure keeps data and time, and recovery clears the warning only with current data"; "B1-STALE expired access requires sign-in and shows no order data; a typed reason returns with it". |
| B2 | **PASS** | "B2 accepted names, prices and totals stay fixed after the menu changes" (prices changed, dishes renamed and removed); "B2 detail shows accepted values, time, status and history". |
| B3 | **PASS** | Illegal transitions refused; employee and time recorded; final states immutable; blank reason refused; dialog dismissal by button and Esc changes nothing and keeps the reason; staff may finish orders after closing; uncertain write never resent. |
| B3-CONFLICT | **PASS** | 100 concurrent pairs give exactly one success and one explained conflict, with a deliberate retry valid; 50 more pairs across two server processes. Browser: two employees; refresh during the confirmation dialog keeps the chosen revision. |
| C1 | **PASS** | Link opens only its order without login, in a separate browser context; 256-bit token; invalid, missing and guessed-number links return an identical result; a 503 is not presented as an invalid link; snapshot contains no staff names, history or revision. |
| C2 | **PASS** | Automatic updates; failure keeps status and time with warning; recovery obtains the new status before clearing it; no invented status or check time on initial failure. |
| C3 | **PASS** | Each status checked for its message and whether it invites pickup; Ready shows number, instructions, location and payment; Cancelled shows the exact reason and labeled contact, HTML-escaped; the stale warning is verified for all five statuses. |
| ACCESS | **PASS** | "ACCESS every staff read and write refuses unauthenticated callers and a tracking token grants nothing" (no cookie, forged cookie, token as cookie, token as bearer); deauthorized employee loses access at once. |
| EXPERIENCE | **PASS, automated scope only** | axe-core WCAG 2.1 A/AA scan clean on 9 screens (Chromium, phone width). Keyboard ordering; typing and focus survive automatic updates; no sideways scroll at 390 px on ordering, tracking and staff pages; core journeys on Chromium and WebKit. Not tested: real phones, screen readers, Firefox. |
| RUN | **PASS, local only** | `npm start` from an empty data directory on a clean clone: order placed on a phone-sized page, staff signed in with generated credentials, status updated live on tracking; server stopped and the stale warning appeared; restart recovered the status; staff session and history survived; saved link opened in a separate browser. Logs contained no password or tracking token. **No live deployment was performed**; account-dependent steps are in [implementation.md](implementation.md). |

Result counts: 18 of 18 acceptance IDs pass within the scope stated. None failed. None were left unrun, but EXPERIENCE and RUN carry the limits shown.

## Quality targets

Conditions for all network-related rows: client and server on the same machine over loopback, no network shaping, HTTP clients written in Node that follow browser load order and the browser's 2 s polling and 3 s timeout, not real browsers. Ranges cover three consecutive runs.

| Target | Measured | Status |
|---|---|---|
| Menu: 100 sessions, 95% within 2 s, ≥10 Mbps | p95 4–5 ms; 1,000 loads per run; 0 failed | **Unverified.** Local measurement only, no real network |
| Queue load: 10 sessions, 200 active orders, 95% within 2 s | p95 31–34 ms; 200 loads per run; 0 failed | **Unverified.** Local measurement only |
| Queue freshness: 95% within 5 s | p95 2,025–2,026 ms; 400 observations per run | **Unverified.** Local measurement only |
| Tracking freshness: 100 sessions, 95% within 5 s | p95 1,823–1,900 ms | **Unverified.** Local measurement only |
| Tracking recovery within 5 s | p95 1,840–1,909 ms; slowest 2,001 ms, after a real server stop and restart with a newer status | **Unverified.** Local measurement only |
| Submission reliability: 100 cases | 100 cases, 0 wrong outcomes, exactly 75 orders for 75 accepted, 0 for rejected, in each of three runs. Lost responses simulated by the client aborting after sending | **Met in this local measurement** |
| Staff consistency: 100 pairs | 100/100 in each of three runs, one success, one explained conflict, valid deliberate retry | **Met in this local measurement** |
| Human usability: order within 3 minutes | Not run; no participants | **UNRUN** |
| Human usability: identify status within 15 seconds | Not run; no participants | **UNRUN** |

An early version of the measurement opened 500 connections in the same instant and crashed on a connection reset, because the machine's accept queue holds 128 (`kern.ipc.somaxconn`). The measurement now models browser load order with a 500 ms ramp and counts failures. A deployed host's accept-queue limit is worth checking under real load.

## Defects found and fixed during verification

| Found by | Defect | Fix commit |
|---|---|---|
| Browser test | `aria-current` and `aria-invalid` were escaped into invalid markup | `7e43d24`, `b762f27` |
| Spec review | A malformed request path crashed the server process | `b762f27` |
| Spec review | An order could be placed before the cart re-check finished | `b762f27` |
| Spec review | A closed rejection lost its next-opening text if the menu never loaded | `b762f27` |
| Code review | Corrupted browser storage broke the customer page | `b762f27` |
| Code review | Actions re-enabled before an uncertain write's state was read | `7e43d24` |
| WebKit run | A test-harness leak hung the run, and two tests assumed Chromium behavior (test code only) | `85ed047` |

## Remaining limitations

- No live deployment; localhost HTTP only.
- WebKit coverage is Playwright's desktop WebKit at phone width, not iOS Safari on a device.
- Firefox, screen readers and physical phones were not tested.
- The accessibility scan finds only automatically detectable issues, and it ran on Chromium.
- GitHub: no `origin` remote exists in this repository, so nothing was pushed and no draft PR was opened.
