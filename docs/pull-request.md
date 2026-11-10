# Draft PR: Mesa Tica pickup ordering (Round 3 implementation)

> Saved locally because this checkout has no `origin` remote, so the branch could not be pushed and no draft PR
> could be opened. Use this text as the PR description against `main` when the branch is published. The progress
> notes below are the milestone comments that would have been posted on the PR.

## Summary

Complete Mesa Tica pickup-ordering application built from the Round 3 context at
`e18f506f98a21f121ec02ab72001793073e48f1d` on branch `implementation/round3-claude`, following [KICKOFF.md](../KICKOFF.md).
Product/design documents are unchanged.

- Node.js standard library server (`node:http`, `node:sqlite`), no runtime npm dependencies; vanilla browser modules.
- Guest menu with opening state and next opening in Costa Rica time (including the no-upcoming-opening branch),
  cart with exact CRC totals and quantity corrections, reviewed submission that rechecks prices, availability and
  hours at an indivisible acceptance boundary.
- Uncertain-submission recovery (Check order / Retry safely) bound to the reviewed selection; recorded rejections
  stay closed; duplicates are impossible per (browser context, attempt).
- Confirmation with copy/manual-copy, save/privacy guidance, same-tab restoration via the private-link read path,
  stale handling and storage-failure guidance.
- Private tracking (192-bit links) with automatic updates, last-check time, stale warnings and status guidance.
- Staff sign-in (scrypt, revocable sessions, attempt limiting), Active-by-default queue and filters, accepted detail
  and history, revision-bound status changes with conflict explanation, cancellation reason + confirmation, draft
  recovery across refresh failure and reauthentication.
- Repeatable noninteractive setup with generated local staff credentials; explicit password reset command.

## Docs

- [docs/implementation.md](implementation.md): run/sign-in/config/deployment, architecture and design-to-code mapping, decisions.
- [docs/verification.md](verification.md): PASS/FAIL/UNRUN per acceptance and quality-target ID with evidence.
- [docs/backlog.md](backlog.md): remaining work.

## Checks run

- `npm test` → 60 passed, 0 failed.
- `npm run test:browser` → 37 passed, 0 failed (Playwright 1.63.0, Chromium, phone + desktop profiles).

## Remaining / limitations

- No hosted deployment or real HTTPS session (account-dependent); RUN verified locally only.
- Q-MENU, Q-QUEUE, Q-TRACKING (load/network) and both human usability targets are UNRUN.
- Screen-reader output and cross-browser (WebKit/Firefox/iOS Safari) behavior not verified.

## Progress notes (would-be PR comments)

1. **Runnable foundation (`cf12e0a`).** Backend stores, policies, services, controllers, setup and server entry.
   Verified by hand: setup twice (second run preserved everything), `POST /api/orders` → 201 with ₡7,900, text/plain →
   415, malformed JSON → 400. No UI yet.
2. **Views + unit/API checks (`b5641cd`).** Customer, tracking and staff pages and the shared UpdateCoordinator.
   `npm test` → 59/59, including real-process restart and two-process concurrency. UI not yet exercised in a browser.
3. **Browser suite (`f13931b`).** 37 Playwright journeys covering ordering, recovery, confirmation restoration,
   staff conflict/cancellation, access expiry with draft recovery and tracking stale/recovery. 37/37 in two
   consecutive runs; 59/59 node checks. Fixed a stretched status badge and repeated dialog wording found in screenshots.
4. **Documentation and final state.** Implementation, verification and backlog docs; added
   `npm run staff:reset-password` with a test. Final run: 60/60 node, 37/37 browser. Remaining items as listed above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
