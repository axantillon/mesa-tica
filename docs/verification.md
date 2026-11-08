# Verification

Executed 2026-11-08: `node --check server.js`, `node --check public/app.js`, and `npm test` passed. The isolated test started a fresh SQLite database and server during open hours, checked nine menu entries and unavailable fish; two logins and empty initial queue; rejected anonymous staff access; simultaneous repeated submission with ₡7,900 total and one order; recovery and invalid tracking token; no public history; concurrent competing changes with one success and one conflict; forbidden transition; durable rejection of unavailable fish; and restart plus repeat setup preserving an order and staff credentials. Subsequently, Playwright WebKit was run against a separate temporary database on port 31480. The browser journey added chicken, cheese empanada and two iced teas, confirmed ₡7,900 and placed the order; staff signed in, opened the order, marked it Preparing, dismissed a cancellation confirmation, and marked it Ready. The open tracking page updated to Ready with pickup guidance. Simulated offline mode preserved Ready with a stale warning; reconnecting cleared the warning after a successful refresh. No private links or credentials are retained in this record. The in-app browser itself was unavailable; Playwright WebKit required a sandbox escalation to launch.

PASS means the entire criterion was verified; UNRUN includes partial automated evidence, not a claim that the feature is absent. No manual human study, performance, load, production deployment or restore exercise was performed.

| ID | Result | Evidence / remaining verification |
|---|---|---|
| SETUP | UNRUN | Fresh setup, two accounts, repeat setup and restart covered by `npm test`; complete setup and history preservation journey needs manual verification. |
| A1 | UNRUN | Menu and fish flag checked; closed boundary and browser states not tested. |
| A2 | UNRUN | Worked ₡7,900 accepted total checked; browser quantity correction and remaining examples not tested. |
| A3 | UNRUN | One valid order and unavailable rejection checked; full invalid and closed cases remain. |
| A3-REVIEW | UNRUN | Server checks prices and availability; changed-menu review journey not tested. |
| A4 | UNRUN | Concurrent same-attempt acceptance, recovery and durable rejection checked; lost response and retry after closing remain. |
| A5 | UNRUN | Confirmation implemented; clipboard, recovery statuses and selection clearing need browser checks. |
| B1 | UNRUN | Staff authentication and initial empty queue checked; filters and automatic UI updates not tested. |
| B1-STALE | UNRUN | Stale handling implemented; outage and recovery not tested in browser. |
| B2 | UNRUN | Detail and history checked; menu change snapshot test remains. |
| B3 | UNRUN | Invalid transition and attributed history checked; complete lifecycle and cancellation confirmation need browser verification. |
| B3-CONFLICT | UNRUN | One concurrent conflict pair checked; confirmation revision and deliberate recovery remain. |
| C1 | UNRUN | Invalid token rejected, public history omitted; full capability and timeout checks remain. |
| C2 | PASS | Playwright WebKit showed the open tracking page update to Ready, preserve its last status and check time offline, and clear the stale warning after reconnecting. |
| C3 | UNRUN | Status-specific instructions implemented; all statuses not tested in browser. |
| ACCESS | UNRUN | Anonymous staff queue rejected; all bypass and session expiry paths need verification. |
| EXPERIENCE | UNRUN | No browser, keyboard, responsive or human study completed. |
| RUN | UNRUN | Isolated API and browser ordering-to-Ready journeys passed; Collected and restart through the browser remain unverified. |

All stated concurrency/load, 100-case reliability/consistency and human-usability targets remain UNRUN. One successful test pair is not a measurement of those targets.

Playwright also exposed unnecessary staff queue DOM replacement on every unchanged poll; the follow-up fix retains the existing controls when the snapshot has not changed, while updating the check time. The staff order could then be opened and advanced in the same test. Other acceptance IDs remain UNRUN until all their listed outcomes are checked.
