# Mesa Tica backlog

Observed remaining work after the local implementation and verification. Priorities: P1 needed before a real
launch, P2 should follow soon, P3 improve when the need is shown.

| # | Item | User benefit | Acceptance criteria | Priority | Dependencies |
|---|---|---|---|---|---|
| 1 | Hosted HTTPS deployment | Customers and staff can use the product away from the developer's machine; staff sessions travel only over HTTPS. | App runs on a host with a persistent local volume for `MESA_DATA_DIR`, behind TLS, with `MESA_SECURE_COOKIES=true`; staff can sign in over HTTPS and the cookie carries `Secure`; a restart keeps orders, history and links; RUN re-verified on that host. | P1 | Hosting account, domain/TLS certificate (account-dependent, not available here). |
| 2 | Measure Q-MENU, Q-QUEUE, Q-TRACKING | Confidence that pages load and updates arrive in time during a lunch rush. | Load test with the specified sessions/orders over ≥10 Mbps connections; report 95th-percentile load times and update latency per target; failures recorded, not replaced. | P1 | Item 1 (or a representative networked environment), a load-generation tool. |
| 3 | Human usability studies (Q-USABILITY-ORDER, Q-USABILITY-TRACKING) | Evidence that first-time customers can order and read status unaided. | 10 participants per study, timed tasks as specified, results and issues recorded. | P2 | Item 1 or a reachable test host; participants. |
| 4 | Screen-reader and real text-zoom review | Customers and staff using assistive technology get the same information and announcements. | VoiceOver (iOS/macOS) and NVDA or TalkBack walkthroughs of ordering, recovery, tracking (including stale warnings) and staff cancellation; issues fixed and re-tested. | P2 | None. |
| 5 | Cross-browser runs | Works on the phones customers actually use (notably iOS Safari). | Browser suite also passes on Playwright WebKit and Firefox; a manual pass on a real iPhone and Android device. | P2 | Playwright browser downloads. |
| 6 | Shared sign-in attempt limiter for multi-process hosting | Consistent protection against password guessing when several app processes serve staff. | Failure counters stored in SQLite (or the shared store) so limits apply across processes; existing limiter tests pass with two processes. | P3 | Only if more than one process serves staff. |
| 7 | Automated backups and retention guidance | Orders and history survive disk loss. | Scheduled SQLite online backup with restore instructions verified by a restore test. | P3 | Item 1. |
| 8 | Push updates (Server-Sent Events) | Lower update latency and less polling traffic at scale. | Queue/detail/tracking updates arrive via SSE with polling fallback; stale/recovery behavior unchanged; Q-QUEUE/Q-TRACKING re-measured. | P3 | Only if item 2 shows polling is insufficient. |
| 9 | Clean up temporary data directories after API tests | Developer machines do not accumulate test databases. | `npm test` leaves no new directories under the OS temp folder. | P3 | None. |
