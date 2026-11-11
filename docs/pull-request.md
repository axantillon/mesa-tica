# Draft pull request description

The text below is the description of draft PR [#9](https://github.com/axantillon/mesa-tica/pull/9), from `implementation/round2-anthropic` into `main`.

---

**Title:** Build the Mesa Tica pickup-ordering application

## Outcome

The complete product runs locally from `npm start`. All 18 acceptance IDs pass in automated local checks, with the limits stated in the verification record. There has been no live deployment and no human study.

## Implemented

- **Ordering:** menu with opening rules in restaurant time, same-browser cart with corrections, reviewed submission, exactly-one acceptance per attempt, honest recovery of uncertain outcomes, confirmation with link copy and fallback.
- **Staff:** provisioned sign-in with limiting, Active-first queue with all filters, automatic updates with stale and recovery states, order detail with accepted values and history, revision-bound status changes with conflict handling, two-step cancellation.
- **Tracking:** private 256-bit links with no login, automatic updates, status-specific guidance, stale warnings, and no staff identities exposed.
- **Setup:** one repeatable, noninteractive command; staff passwords are generated into a gitignored file.

Node.js standard library and plain browser modules; no runtime dependencies. SQLite provides the transactional guarantees.

## Checks actually run

| Check | Result |
|---|---|
| `npm test` | 39 of 39 passed |
| `npm run test:e2e`, Chromium, with axe-core WCAG A/AA scan | 55 of 55 passed |
| Browser journeys on WebKit | 54 of 54 passed |
| `npm start` from empty data on a clean clone, full journey through restart | Passed |
| `npm run measure`, three runs | Reliability and consistency targets met locally; timing targets measured on loopback only |
| Secret scan of git history | 0 matches |

## Remaining

Not done: live deployment, human usability studies, real-network performance, screen-reader and physical-device testing. Abuse limits on anonymous ordering and database backups should precede any public use. See the backlog.

## Documentation

- [Implementation: architecture, setup, sign-in, design mapping, decisions](https://github.com/axantillon/mesa-tica/blob/implementation/round2-anthropic/docs/implementation.md)
- [Verification results for each acceptance ID](https://github.com/axantillon/mesa-tica/blob/implementation/round2-anthropic/docs/verification.md)
- [Backlog](https://github.com/axantillon/mesa-tica/blob/implementation/round2-anthropic/docs/backlog.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
