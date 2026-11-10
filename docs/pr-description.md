# Prepared draft PR update

Destination: existing draft https://github.com/axantillon/mesa-tica/pull/10, `implementation/round3-openai` → `main`. Final update/comment were not posted because automatic approval review rejected the external progress upload; no workaround was used after the second rejection. Final local work remains available for review and publication when approved.

## Title

Build complete Mesa Tica pickup ordering from Round 3 context

## Description

Mesa Tica now supports guest pickup orders, durable safe-retry recovery, persistent confirmation/private tracking access, and authenticated staff fulfillment. It implements the supplied logical design independently from starting commit `e18f506f98a21f121ec02ab72001793073e48f1d`; supplied context/design/kickoff files remain unchanged.

- Customer menu/cart with exact CRC totals, current-price/availability review and restaurant-local opening rules, including no upcoming opening.
- Atomic scoped attempt outcomes, exactly-once acceptance, durable rejection recovery and immutable accepted contents.
- Saved confirmation/private link, reload/back continuity, stale/recovery tracking, copy/manual-save fallback and status-specific guidance.
- Two generated staff accounts, durable sessions, oldest-first filtered queue, accepted detail/history, legal transitions, revision-bound cancellation/conflict handling and same-order draft restoration after sign-in.
- Node 24, SQLite WAL and browser ES modules; no runtime third-party dependencies, paid services or external credentials. Configurable host/port/data path/Secure cookie setting.

Actual checks:

- `npm run setup` and `npm start` succeeded locally; supplied nine-item menu returned by HTTP.
- `npm run check` and `git diff --check` passed.
- `npm test`: 11/11 passed in 2.55s. Includes 100 submission reliability cases, 100 conflicting staff pairs, independent queue ordering, request/access boundaries, accepted snapshot preservation and executable restart/nondefault listener/data path.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/mesa-browsers npm run test:browser`: 15/15 passed in 49.0s, retries disabled. Includes actual ordering, uncertain/reload recovery, confirmation restoration, storage/clipboard failures, staff cancellation/conflict/access expiry, uncertain staff write, stale tracking/recovery and rendered keyboard/reflow/accessibility checks.
- Actual runtime desktop/mobile smoke: correct title/URL, meaningful app, no console errors, no horizontal overflow. Screenshots stayed local and were visually inspected.

Earlier accessibility/test failures and their fixes remain documented. Network-conditioned load targets, actual human studies, real assistive-technology speech/device coverage and hosted HTTPS remain UNRUN. No deployment, reviewers, merge or auto-merge requested.

Documentation:

- [Architecture/setup/sign-in/hosting](https://github.com/axantillon/mesa-tica/blob/implementation/round3-openai/docs/implementation.md)
- [Each acceptance and quality result](https://github.com/axantillon/mesa-tica/blob/implementation/round3-openai/docs/verification.md)
- [Remaining evidence/environment work](https://github.com/axantillon/mesa-tica/blob/implementation/round3-openai/docs/backlog.md)

## Prepared final progress comment

Local implementation is complete. Service tests passed 11/11 and browser tests passed 15/15 with retries disabled. The reliability suite verifies 100 submission cases and 100 competing staff-update pairs, with exact counts and no-write assertions. Actual localhost runtime and desktop/mobile screenshots were checked. Earlier failed runs and fixes are retained in docs/verification.md. Network load, human studies and hosted HTTPS remain UNRUN; no public deployment was performed. Setup/sign-in/run instructions and architectural mapping are in docs/implementation.md; remaining work is in docs/backlog.md. Leave this PR in draft and open.
