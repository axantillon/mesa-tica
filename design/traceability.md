# Design and acceptance traceability

All eleven user stories have a detailed interaction sequence. Every named responsibility below is defined in `diagrams/06-detailed-design.mmd`; runtime boundaries are in `diagrams/05-logical-architecture.mmd`.

| Story | Product capability | Sequence in diagrams/ | Logical responsibilities | Acceptance IDs |
|---|---|---|---|---|
| A1 | Menu/opening | A1-menu.mmd | CustomerView, MenuController, MenuService, OpeningPolicy, MenuStore, RestaurantStore | A1 |
| A2 | Cart review | A2-cart.mmd | CustomerView, Cart, CartItem | A2 |
| A3 | Reviewed acceptance | A3-checkout.mmd | CustomerView, Cart, OrderController, CheckoutService, OpeningPolicy, OrderStore, MenuStore, RestaurantStore, SubmissionIdentity, Order, OrderedItem, Confirmation | A3, A3-REVIEW |
| A4 | Uncertain submission recovery | A4-submission-recovery.mmd | CustomerView, Cart, OrderController, CheckoutService, OrderStore (readAttemptOutcome), SubmissionIdentity, Order, Confirmation | A4 |
| A5 | Confirmation, saved link and same-tab restoration | A5-confirmation-link.mmd; C1-private-summary.mmd; C2-tracking-refresh.mmd | CustomerView, Confirmation, Cart, TrackingView, TrackingController, TrackingService | A5, C1, C2 |
| B1 | Access and queue | B1-queue.mmd | StaffView, AuthController, AccessService, IdentityStore, UpdateCoordinator, StaffOrderController, OrderService, OrderStore | B1, B1-STALE, ACCESS |
| B2 | Accepted detail | B2-detail.mmd | StaffView, UpdateCoordinator, StaffOrderController, AccessService, OrderService, OrderLifecycle, OrderStore, Order, OrderedItem, StatusChange | B2, ACCESS |
| B3 | Progress and conflict | B3-transition.mmd | StaffView, StaffOrderController, AccessService, OrderService, OrderLifecycle, OrderStore, Order, StatusChange, Employee | B3, B3-CONFLICT, ACCESS |
| C1 | Private access | C1-private-summary.mmd | TrackingView, TrackingController, TrackingService, OrderStore | C1, ACCESS |
| C2 | Current status | C2-tracking-refresh.mmd | TrackingView, UpdateCoordinator, TrackingController, TrackingService, OrderStore | C2 |
| C3 | Collection guidance | C3-instructions.mmd | TrackingView, TrackingController, TrackingService, OrderStore, RestaurantStore | C3 |

SETUP and RUN cover startup, persistent operation and provisioning through `S1-setup.mmd` and the logical architecture. SetupRunner coordinates RestaurantStore, MenuStore and IdentityStore. REQUEST covers representation/value validation at the existing request controllers and page handlers; the request-boundary annotation in the architecture marks this shared responsibility. EXPERIENCE applies across journeys. A5 also exercises offline return and unavailable browser storage; B3-CONFLICT exercises same-order draft restoration after reauthentication. Context, concepts, lifecycle and shared-rule diagrams support all stories. Quality targets in `context/acceptance.md` require measurement and are separate from functional coverage.
