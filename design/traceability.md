# Product traceability

The product has nine user stories. Product details are in `context/product-specification.md`; screen behavior/messages are in `context/experience.md`.

| User story | Product section | Sequence in diagrams/ | Acceptance IDs |
|---|---|---|---|
| A1 | Menu and opening state | A1-menu.mmd | A1 |
| A2 | Cart review and quantity correction | A2-cart.mmd | A2 |
| A3 | Acceptance, review, recovery and saved link | A3-checkout.mmd | A3, A3-REVIEW, A3-RETRY, A3-LINK |
| B1 | Staff access, queue and freshness | B1-queue.mmd | B1, B1-STALE, ACCESS |
| B2 | Accepted order details | B2-detail.mmd | B2 |
| B3 | Progress, cancellation and conflict recovery | B3-transition.mmd | B3, B3-CONFLICT, ACCESS |
| C1 | Private saved-link access | C1-private-summary.mmd | C1, ACCESS |
| C2 | Automatic status and interrupted updates | C2-tracking-refresh.mmd | C2 |
| C3 | Ready, cancelled and collected guidance | C3-instructions.mmd | C3 |

SETUP and RUN cover startup and operation; EXPERIENCE applies across journeys. Quality targets are separate from functional acceptance checks.
