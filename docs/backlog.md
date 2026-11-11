# Backlog

Remaining work observed during the build. Priority: P1 before any public use, P2 before relying on it day to day, P3 when the need appears.

| # | Item | User benefit | Acceptance criteria | Priority | Depends on |
|---|---|---|---|---|---|
| 1 | Live HTTPS deployment | Customers and staff can use the app away from this machine | Reachable over HTTPS on a persistent host with `MESA_SECURE_COOKIES=1`; the RUN journey passes there; data survives a host restart | P1 | A hosting account; decision on host |
| 2 | Limit anonymous order requests | The restaurant isn't overwhelmed by scripted orders, and rejected attempts can't fill the disk | Per-client limits on `POST /api/orders` and `/recover` that never block recovery of an already accepted attempt; old closed attempts are pruned; verified under a scripted flood | P1 | Item 1, which determines how the client address is obtained behind the proxy |
| 3 | Scheduled database backups and tested restore | Orders and history survive a disk failure | Automated backup of `mesa.db` with WAL handled correctly; a restore drill recovers orders, status history and private links | P1 | Item 1 |
| 4 | Human usability studies | Confirms real people can order and read status unaided | The two study targets in `context/acceptance.md` measured with real participants: 9/10 complete a three-item order in 3 minutes; 9/10 identify status in 15 seconds | P1 | Recruited participants, deployed or local build |
| 5 | Performance on real networks and devices | Confirms the 2 s and 5 s targets where customers actually are | Targets measured over real connections of at least 10 Mbps, with the server and clients on separate machines and phones included | P2 | Item 1 |
| 6 | Manual screen-reader pass | People using assistive technology can complete every journey | Ordering, tracking and staff journeys completed with VoiceOver and TalkBack; issues fixed. Automated axe checks are clean, but they can't prove this | P2 | None |
| 7 | Browser coverage on real phones | Fewer surprises on the devices customers use | Journeys run on iOS Safari and Android Chrome hardware, plus Firefox. Automated runs covered desktop Chromium and WebKit engines with phone-sized windows only | P2 | None |
| 8 | Staff password rotation | A lost or exposed password can be replaced without touching the database by hand | A documented noninteractive command that sets a new password for one account, ends its sessions and leaves orders and history alone | P2 | None |
| 9 | Paginate or bound long order lists | The All, Collected and Cancelled filters stay fast after months of orders | Lists stay within the 2 s target at a realistic retained volume, with oldest-first order preserved | P3 | Real order volume |
| 10 | Shared sign-in limiter | Sign-in limits stay accurate if the app ever runs as several processes | Failure counts persist across processes and restarts, with tests | P3 | A decision to run more than one instance |
| 11 | Push updates | Fewer background requests on busy days | Server-sent updates with polling kept as fallback; freshness, stale and recovery checks still pass | P3 | Measured polling cost that justifies it |
