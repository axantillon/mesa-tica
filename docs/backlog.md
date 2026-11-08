# Backlog

| Priority | Work | User benefit | Acceptance | Dependencies |
| --- | --- | --- | --- | --- |
| P1 | Measure production-shaped menu, queue and tracking responsiveness | Customers and staff get timely information during a rush | Run the exact session, order and network conditions in the [quality targets](../context/acceptance.md#quality-targets). Record load and update p95 and tracking recovery time. | Representative HTTPS host, browser load runner and network shaping |
| P1 | Validate first-time use with participants | Guests can order and decide when to collect unaided | Record both usability tasks with 10 participants each and compare results to the specification's completion and time thresholds. | Participants, observation protocol and accessible demo environment |
| P1 | Verify the HTTPS deployment and restore workflow | Staff can resume operations and customers can use saved links across devices | Verify Secure staff cookies, cross-device tracking and restore of accepted orders/history from a protected backup on the target setup. | Host, hostname, TLS, persistent disk and backup destination |
| P2 | Extend browser and assistive-technology coverage | More customers and staff can complete the same journeys | Run ordering, cancellation, stale tracking and keyboard navigation in WebKit and Firefox. Verify status announcements with a screen reader and test on physical phone and tablet hardware. | Supported browsers, devices and assistive technology |
