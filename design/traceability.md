# Design and acceptance traceability

All nine user stories have a detailed interaction sequence. Every named responsibility below is defined in `diagrams/06-detailed-design.mmd`; runtime boundaries are in `diagrams/05-logical-architecture.mmd`.

| Story | Product capability | Sequence in diagrams/ | Logical responsibilities | Acceptance IDs |
|---|---|---|---|---|
| A1 | Menu/opening | A1-menu.mmd | CustomerView, MenuController, MenuService, OpeningPolicy, MenuStore, RestaurantStore | A1 |
| A2 | Cart review | A2-cart.mmd | CustomerView, Cart, CartItem | A2 |
| A3 | Acceptance and recovery | A3-checkout.mmd | CustomerView, OrderController, CheckoutService, OpeningPolicy, OrderStore, MenuStore, RestaurantStore, SubmissionIdentity, Order, OrderedItem, Confirmation | A3, A3-REVIEW, A3-RETRY, A3-LINK |
| B1 | Access and queue | B1-queue.mmd | StaffView, AuthController, AccessService, IdentityStore, UpdateCoordinator, StaffOrderController, OrderService, OrderStore | B1, B1-STALE, ACCESS |
| B2 | Accepted detail | B2-detail.mmd | StaffView, StaffOrderController, AccessService, OrderService, OrderStore, Order, OrderedItem, StatusChange | B2 |
| B3 | Progress and conflict | B3-transition.mmd | StaffView, StaffOrderController, AccessService, OrderService, OrderLifecycle, OrderStore, Order, StatusChange, Employee | B3, B3-CONFLICT, ACCESS |
| C1 | Private access | C1-private-summary.mmd | TrackingView, TrackingController, TrackingService, OrderStore | C1, ACCESS |
| C2 | Current status | C2-tracking-refresh.mmd | TrackingView, UpdateCoordinator, TrackingController, TrackingService, OrderStore | C2 |
| C3 | Collection guidance | C3-instructions.mmd | TrackingView, TrackingController, TrackingService, OrderStore, RestaurantStore | C3 |

SETUP and RUN cover startup, persistent operation and provisioning. EXPERIENCE applies across journeys. Context, concepts, lifecycle and shared-rule diagrams support all stories. Quality targets in `context/acceptance.md` require measurement and are separate from functional coverage.
