# Round 3 implementation notes

Starting point: shared design commit `a196dd9`. This is a fresh implementation round; do not use code from earlier implementation branches as the implementation source.

## Evidence to carry forward as requirements

The Round 2 comparison exposed implementation gaps not fully explicit in the shared product design. These notes make those gaps reviewable without prescribing a framework, language, database, class structure or hosting provider.

- Treat malformed JSON, unsupported content types, unknown filters and invalid paths as clear client errors. They must not produce server errors or misleading empty results.
- State explicitly how the application binds to its host and where durable data lives. Make both configurable for the selected host. Behind a proxy, trust forwarded client address/protocol headers only from the known proxy configuration.
- Preserve an accepted order's confirmation and tracking access across reloads in the same browser where feasible. Never persist secrets unnecessarily or expose the private link to another customer.
- Revalidate menu price and availability when reviewing the cart and again at authoritative acceptance. Explain changed values and require a fresh deliberate submission.
- Keep the implementation readable enough to review. Avoid minified or excessively long source lines; split files around cohesive responsibilities when that improves clarity.
- Include a repeatable browser test suite for customer, staff and tracking journeys, alongside isolated API, restart, concurrency and failure-recovery checks. Report what each test actually establishes.
- Treat loopback timing as local evidence only. Do not claim network or quality targets without measuring under their stated conditions. Use repeat runs and retain anomalous failures rather than silently discarding them.
- Make sign-in abuse limits suitable for the intended deployment, and document proxy behavior and operational limits. Do not claim they prevent all abuse.

## Round 2 observations and limits

The shared independent checks found Claude Round 2 ahead by one of 98 API cases; Codex returned HTTP 500 for malformed JSON. A Codex A4 browser check failed once in three runs with `request not sent`; cause remains unknown. Claude's configurable host/data settings and confirmation persistence were useful. Codex's single-machine queue timings were lower in those runs, but the check was loopback and noisy. These observations support the requirements above; they do not prove a model will repeat the result or that either build is ready for production.

Source: Ian's Round 2 report and preserved evidence in the companion `Ian WhatsApp - 2026-11-09` folder. Branches/commits compared: Codex `2c81f17`, Claude `3767c7e`; shared design `a196dd9`.
