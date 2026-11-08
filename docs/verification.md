# Verification

Executed 2026-11-08: `node --check server.js`, `node --check public/app.js`, and `npm test` passed. The isolated test started a fresh SQLite database and server during open hours, checked nine menu entries and unavailable fish; two logins and empty initial queue; rejected anonymous staff access; simultaneous repeated submission with ₡7,900 total and one order; recovery and invalid tracking token; no public history; concurrent competing changes with one success and one conflict; forbidden transition; durable rejection of unavailable fish; and restart plus repeat setup preserving an order and staff credentials. Subsequently, Playwright WebKit was run against a separate temporary database on port 31480. The browser journey added chicken, cheese empanada and two iced teas, confirmed ₡7,900 and placed the order; staff signed in, opened the order, marked it Preparing, dismissed a cancellation confirmation, and marked it Ready. The open tracking page updated to Ready with pickup guidance. Simulated offline mode preserved Ready with a stale warning; reconnecting cleared the warning after a successful refresh. No private links or credentials are retained in this record. The in-app browser itself was unavailable; Playwright WebKit required a sandbox escalation to launch.

Additional Playwright WebKit checks on 2026-11-08 used an isolated database and test-only menu controls. They exercised the three worked cart totals; invalid zero, negative, fractional and empty quantities; retained invalid input after another cart edit; cart persistence; price and availability correction; lost accepted response and same-attempt recovery; both staff accounts and an in-progress cancellation conflict; deliberate cancellation and public reason; all queue filters and filter preservation; staff queue stale/recovery; invalid tracking and initial connection failure; Collected guidance; copy feedback; sign-out; and a 375-pixel viewport/keyboard-focus smoke check. A separate isolated server with an injected test clock checked 09:59:59, 10:00:00, 20:59:59 and 21:00:00 Costa Rica time, dated reopening, and a lost acceptance retried after closing. The application itself uses the real clock; test controls were not committed. Playwright tests were run through the CLI on local isolated data; they do not constitute a human usability study.

PASS means the entire criterion was verified; UNRUN includes partial automated evidence, not a claim that the feature is absent. No manual human study, performance, load, production deployment or restore exercise was performed.

| ID | Result | Evidence / remaining verification |
|---|---|---|
| SETUP | UNRUN | Fresh setup, two accounts, repeat setup and restart covered by `npm test`; complete setup and history preservation journey needs manual verification. |
| A1 | PASS | Supplied menu and unavailable fish inspected; closed browsing and dated reopening checked in WebKit; exact open/close boundaries checked with isolated clock and `npm test`. |
| A2 | UNRUN | All three worked totals, zero/negative/fractional/empty correction, persistence and explicit removal checked; nonnumeric browser input and all interaction variants remain. |
| A3 | UNRUN | One valid order and unavailable rejection checked; full invalid and closed cases remain. |
| A3-REVIEW | PASS | WebKit exercised price change, updated total, retained unavailable item, removal and deliberate resubmission. |
| A4 | UNRUN | Concurrent same-attempt acceptance, durable rejection, lost response, browser recovery and safe retry after closing checked; selection mismatch and all concurrent rejection variants remain. |
| A5 | UNRUN | Copy feedback, accepted contents, save guidance and empty cart after recovery checked; copy failure and recovered final statuses remain. |
| B1 | UNRUN | Both sign-ins, sign-out, seven filters, retained terminal orders, filter preservation and automatic changes checked; oldest-first ties and all loading/access states remain. |
| B1-STALE | UNRUN | WebKit intercepted queue refresh failures and verified stale warning, last check and recovery; session expiry remains. |
| B2 | UNRUN | Detail and history checked; menu change snapshot test remains. |
| B3 | UNRUN | WebKit exercised preparing, ready, collected, cancellation confirmation/dismissal and terminal states; all invalid transition and reason variants remain. |
| B3-CONFLICT | PASS | Two separate staff contexts competed while a cancellation confirmation remained open; conflict displayed the new state, retained reason and allowed deliberate cancellation. |
| C1 | UNRUN | Invalid token, initial connection failure and public omission of staff identity checked; independent-device and full capability checks remain. |
| C2 | PASS | Playwright WebKit showed the open tracking page update to Ready, preserve its last status and check time offline, and clear the stale warning after reconnecting. |
| C3 | UNRUN | Received, Ready, Cancelled reason and Collected guidance checked; every instruction and stale variant not independently asserted. |
| ACCESS | UNRUN | Anonymous staff queue rejected; all bypass and session expiry paths need verification. |
| EXPERIENCE | UNRUN | A 375-pixel horizontal-overflow and keyboard-focus smoke check passed; full responsive, keyboard and human usability checks remain. |
| RUN | UNRUN | Browser ordering through Collected and API restart passed; complete journey across a browser restart remains unverified. |

All stated concurrency/load, 100-case reliability/consistency and human-usability targets remain UNRUN. One successful test pair is not a measurement of those targets.

Playwright also exposed unnecessary staff queue DOM replacement on every unchanged poll; the follow-up fix retains the existing controls when the snapshot has not changed, while updating the check time. The staff order could then be opened and advanced in the same test. Other acceptance IDs remain UNRUN until all their listed outcomes are checked.

Follow-up fixes: invalid quantity drafts now remain visible and disable submission across cart edits; closed notices include the next opening date; switching staff filters displays loading instead of briefly presenting the old results. `npm test` includes the opening-boundary regression.
