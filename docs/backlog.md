# Remaining work

| Priority | Work and user benefit | Acceptance criteria | Dependencies |
|---|---|---|---|
| High | Verify and repair full browser journeys so customers and staff can rely on the interface. | Exercise remaining acceptance outcomes, including lost responses, closing boundaries, changed menus, staff stale recovery, confirmed cancellation and keyboard/mobile workflows; document results and fix failures. | Working browser and controlled test clock/network. |
| Medium | Verify opening-state changes across a live browser session. | The page updates opening state without losing cart input; server remains authoritative. | Browser and controlled clock. |
| High | Prepare a safe hosting design before any public deployment. | TLS, secure cookies, backup/restore, process management, persistent storage, shared rate limiting and security review are documented and validated in the selected environment. | Hosting decision and operational resources. |
| Medium | Measure quality targets so capacity and usability claims are evidence-based. | Run specified concurrency/reliability and conflict measurements and actual participant studies; publish conditions and results. | Test environment, tooling and participants. |
| Medium | Improve automated coverage of all status and correction paths. | Tests cover all lifecycle edges, price changes, closing boundaries and stale/recovery behavior without touching live data. | Isolated clock and browser tooling. |
