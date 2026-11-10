# Verification record

Local verification against starting context `e18f506f98a21f121ec02ab72001793073e48f1d`. Commands below run from the repository root. Dates shown by tests are controlled fixture dates, not claims of real restaurant activity. No human study or hosted deployment occurred.

## Commands and final outcomes

| Command | Actual outcome |
|---|---|
| `npm run setup` | PASS: local ignored database/configuration and generated staff access; no customer orders seeded |
| `npm start` then GET `http://127.0.0.1:3000/api/menu` | PASS: normal listener starts, supplied identity and 9 menu items returned |
| `npm run check` | PASS: server/customer/staff JavaScript syntax |
| `npm test` | PASS: 11/11 Node HTTP/service tests, most recent run 2.55s; isolated temporary SQLite and injected clocks |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/mesa-browsers npm run test:browser` | PASS: 15/15 Chromium browser tests, 49.0s, one worker, no automatic retries |
| `git diff --check` | PASS: no whitespace errors |

Installation used `npm install --cache /tmp/mesa-npm-cache --save-dev @playwright/test @axe-core/playwright` and `PLAYWRIGHT_BROWSERS_PATH=/tmp/mesa-browsers npx playwright install chromium`. The lockfile supports clean `npm ci`; only Chromium is selected by the suite, and `--no-shell` is sufficient for future installs. See [implementation instructions](implementation.md) for dependencies and clean-checkout commands.

Browser plugin was absent, so regular Playwright was used. Chromium needed approved execution outside the desktop filesystem sandbox. Each test starts a loopback server on a random port, provisions generated test passwords and removes its temporary database afterward. Only `tests/fixture.mjs` injects time; normal operation has no clock override or test endpoint. Fault interception either prevents a request or drops its response after the real server accepts/rejects it. No fake acceptance implementation supplies expected results.

## Functional acceptance

`S` means the named test(s) in [service.test.mjs](../tests/service.test.mjs), run by `npm test`; `B` means [browser.spec.mjs](../tests/browser.spec.mjs), run by the browser command above. PASS reflects the executed local scope; explicit environment/human limits follow the table.

| ID | Result | Actual evidence and observable outcome |
|---|---|---|
| SETUP | PASS | S SETUP/RUN begins at zero orders, provisions Luis/Elena, reruns the real setup executable, preserves password and accepted order/history, then restarts |
| A1 | PASS | S boundaries at 09:59:59/10:00/20:59:59/21:00 restaurant-local time; next Tuesday opening and empty schedule. B disabled fish, closed editable cart, next opening/no opening and live closing-time guidance |
| A2 | PASS | B adds duplicate tea into one row; totals 7900 → 8900 and removal to 6500; zero/negative/fractional/nonnumeric edits retained with correction and disabled submit; empty cart disabled. S rejects invalid representations/quantities without orders |
| A3 | PASS | B actual guest checkout without personal/account fields yields one Received order, accepted 7900 total and private link. S rejects empty, unknown, unavailable and closed choices with exact no-write count |
| A3-REVIEW | PASS | S price increases and decreases both rejected before acceptance; explicit reviewed 4600 price yields 8000 total. B lost repricing rejection recovers its correction and retained cart; a new explicit submit accepts. Unavailable dish remains identified for removal |
| A4 | PASS | S simultaneous attempts and durable accepted/rejected outcomes, wrong-context isolation, changed-selection retry, retry after closing and restart. B drops accepted/rejected responses, reloads and checks/retries the original attempt; absent outcome remains uncertain; exact order counts 1/0 asserted |
| A5 | PASS | B actual clipboard success; forced clipboard/storage failure exposes selectable manual-save link and guidance; acceptance clears cart; reload and same-tab back restore access without new orders. Offline refresh retains link/cached status with warning. Recovered Cancelled has current status/reason and no payment invitation |
| B1 | PASS | B sign-in/out, empty Active, automatic arrival and All-filter return retention. S all seven filter choices and default queue; independent queue check asserts [1,3,2] for chronological ordering with a same-time number tie-break. Distinguishable employees exercised |
| B1-STALE | PASS | B failed queue reads retain row and original successful-check time; successful recovery clears warning. Expired/revoked session removes protected data and requests sign-in |
| B2 | PASS | S accepted name/price/total survive replacing the entire menu; restart preserves attributed history. B displays accepted items/time and two employees' accepted changes |
| B3 | PASS | S illegal skips, blank reason, terminal changes rejected with no history write; complete legal lifecycle succeeds. B dismissal/Escape changes nothing, retains reason and restores focus; explicit confirmation saves cancellation/history |
| B3-CONFLICT | PASS | B two separately signed-in employees: Preparing wins while cancellation dialog retains its original revision across refresh; cancellation conflicts and never overwrites history; a new deliberate choice succeeds. Draft survives refresh failure/sign-in only for its order; protected detail disappears while denied; no automatic change. Lost staff-write response reads actual history exactly once |
| C1 | PASS | S 256-bit random key (>=128 required), wrong/missing/numeric links reveal no order; private summary omits employee/history/revision/private key. B saved link reads directly without login; invalid and service-failure messages differ |
| C2 | PASS | B automatic Received/Preparing/Ready/Collected reads, stale Ready warning and current recovery. Initial failure shows neither fabricated order nor last-check time. Coordinator preserves prior successful time; recovered state is read before warning clears |
| C3 | PASS | S and B not-ready guidance, Ready's exact pickup/payment instructions, Cancelled reason/labeled unmonitored demo contact and Collected without another pickup invitation. Terminal links remain usable; no public employee identity |
| ACCESS | PASS | S unauthorized queue/detail/write, tracking key used as staff cookie, sign-out and actual eight-hour expiry deny access; no history written. B denial removes protected summary/draft text from the visible sign-in page |
| REQUEST | PASS | S every JSON-body endpoint rejects malformed JSON with 400 and unsupported media with 415; authorized unknown filter 400; order count/history unchanged and ordinary writes still succeed. HTML pages are read-only GET delivery; no alternate form-body interface exists, so equivalent non-JSON form parsing is N/A |
| EXPERIENCE | PASS (local rendered scope) | B keyboard skip-to-main, quantity field errors/labels, status announcements, unchanged focused reason through automatic reads, closing-time focus preservation, dialog focus/Tab/Shift-Tab/Escape/return, 200% text reflow without horizontal scroll/text-button overlap, 44px buttons/nav, reduced-motion mode and axe contrast/name/semantic checks. Screenshots visually inspected on phone, desktop and staff tablet. Actual VoiceOver speech/device usability remains UNRUN; no universal accessibility/HIG-compliance claim |
| RUN | PASS (local) | S actual executable with `HOST=127.0.0.1`, `PORT=0` and nondefault temporary `DATA_PATH`, preserving order/private link/history across restart. Secure-cookie flag tested locally. Actual default `npm start` and menu HTTP response verified separately. Hosting/persistent-volume/HTTPS settings documented; real TLS deployment remains UNRUN |

## Quality targets — separate from functional acceptance

| ID | Result | Measurement and limits |
|---|---|---|
| Q-MENU | UNRUN | No 100-session test with specified >=10 Mbps connections; local smoke/functional durations do not establish p95 <=2s |
| Q-QUEUE | UNRUN | No measured 10-staff/200-active-order workload with stated network and p95 latency/update constraints |
| Q-TRACKING | UNRUN | No 100-session network-conditioned percentile test; individual functional updates/recoveries observed automatically within the test's 10s expectation window, not a <=5s load-target proof |
| Q-SUBMISSION | PASS (local functional reliability workload) | S 100 cases covering valid/repeated/recovered/discarded-response/rejected attempts; exact cumulative counts and matching original outcomes asserted each time: 75 accepted orders, 25 closed attempts, zero duplicates. B additionally drops actual acceptance/rejection responses on the transport and recovers after reload. No throughput claim |
| Q-CONSISTENCY | PASS (local consistency workload) | S 100 pairs of individually valid same-revision Preparing changes from Luis/Elena. Every pair asserts [200,409], explained conflict, revision 2/history length 1; a fresh deliberate Ready succeeds with history length 2. B additionally verifies competing different targets and frozen dialog revision |
| Q-USABILITY-ORDER | UNRUN | No actual participants; fictional audience profiles and automation are not a 9/10 unaided three-minute study |
| Q-USABILITY-TRACKING | UNRUN | No actual participants; automation is not a 9/10 readiness-identification study |

## Failures retained and resolved

1. Default npm cache was unwritable (EPERM). Installation succeeded using `/tmp/mesa-npm-cache`; no system-cache ownership change attempted.
2. Initial browser invocation: 12 launch failures, Chromium SIGABRT/EPERM before app interaction inside the desktop sandbox. The approved outside-sandbox run launched successfully; these are infrastructure failures, not 12 observed product regressions.
3. First executable browser run: 11/12 passed; axe reported `label-content-name-mismatch` on disabled Fish casado (“Unavailable” visible versus “Add Fish casado” accessible name). Corrected the accessible name; the focused follow-up passed that assertion.
4. Focused follow-up then failed modal Tab wrapping (1 failed). Added explicit two-button Tab/Shift-Tab cycling. Screenshot review also exposed enlarged-text copy/button crowding and skip-link presentation during full-page capture; dish rows now wrap and skip navigation focuses main. Focused EXPERIENCE passed 1/1 (7.3s total).
5. Expanded suite passed 14/14 (37.8s). Stronger later touch-target assertion exposed the Menu link's width <44px: 13/14 passed, EXPERIENCE failed. Added minimum width; this was a new assertion identifying a gap, not an unexplained flaky outcome.
6. Final suite includes the new closing-time/focus regression: **15/15 passed in 49.0s**, retries disabled. After adding an independent queue ordering/tie-break assertion, the most recent service run **11/11 passed in 2.55s**. No unresolved contradictory result remains in the executed scope.

The first combined Git commit/push escalation was rejected by automatic review. A local-only commit succeeded; a subsequent branch-only push, explicitly citing the kickoff's authorization, succeeded. The final PR progress comment and a shorter variant were later rejected by automatic review as unauthorized external project-data uploads. Publication was stopped until the user explicitly authorized it with “push”. Final source commit `46acb78`, the PR description and final progress comment were then published successfully; the PR remains open and in draft. No credential or database files were staged or uploaded.

## Rendered evidence and review

Screenshots are local, uncommitted artifacts in `/tmp/mesa-evidence`: `desktop-menu.png` (1280px wide), `mobile-menu.png` (390px wide), `mobile-text-200.png`, `mobile-confirmation.png`, `staff-cancellation.png` (1024px wide). `view_image` inspection covered menu hierarchy, typography, exact fictional content/CRC prices, readable status/next steps, responsive cart placement, enlarged-text wrapping and final confirmation dialog. The gold main outline in keyboard screenshots is the intentional focus indicator after skip navigation, not a permanent border.

No reference-image fidelity claim is applicable: supplied textual product/experience documents were the design authority, with no external concept or previous application used. No clipped primary content or unresolved layout overlap was observed in the inspected final screenshots. Axe alone was not used as the usability conclusion; keyboard, focus, error retention and automatic-update behavior were also exercised.

Test-audit review: checks assert independent worked totals, expected lifecycle/status, exact order/history counts, no-write errors, access denial, persistence and recovery. Fault interception preserves the real decision boundary. All test clocks/settings and generated passwords are isolated from runtime data. No unconditional pass or observed-value-as-expectation check is used. Human, broader device/assistive-technology, network/load and hosted outcomes remain explicitly unmeasured in [backlog.md](backlog.md).
