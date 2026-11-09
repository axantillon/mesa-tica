# Remaining work

| Priority | Work and user benefit | Acceptance criteria | Dependencies |
|---|---|---|---|
| Medium | Complete a broader accessibility evaluation so more customers and staff can use the interface confidently. | Review assistive technology, detailed contrast and keyboard journeys across supported devices; fix and document findings. | Accessibility tooling and representative devices. |
| Medium | Verify opening-state changes across a live browser session. | The page updates opening state without losing cart input; server remains authoritative. | Browser and controlled clock. |
| Future deployment | Prepare a safe hosting design before any public deployment. | TLS, secure cookies, backup/restore, process management, persistent storage, shared rate limiting and security review are documented and validated in the selected environment. | Hosting decision and operational resources. |
| Medium | Measure remaining quality targets so capacity and usability claims are evidence-based. | Run representative network/load measurements, full lost-response reliability scenarios and actual participant studies; publish conditions and results. | Test environment, tooling and participants. |
| Medium | Make browser regressions repeatable in continuous integration. | Provide a CI browser environment and automated coverage for critical stale/recovery and interaction paths without touching live data. | Browser-enabled CI environment. |
