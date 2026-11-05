# Product and logical software design

These models define Mesa Tica's boundaries, responsibilities, interactions and consistency guarantees. They are the design to implement. Language, framework, rendering strategy, identity technology, data technology, transport, concurrency algorithms and hosting remain implementation choices.

## Reading the diagrams

Use the [diagram gallery](diagram-gallery.md) for rendered views and the [class reading views](class-views.md) for the detailed model. Raw `.mmd` files are canonical. The Markdown pages mirror them for browser review; implementation can read the sources without rereading duplicate views.

## Models and rationale

| Model | Description and value |
|---|---|
| `01-context.mmd` | Customers, staff, ordering/staff/tracking modules and physical cooking/pickup/payment outside the product. Establishes the boundary so payment processing and delivery do not become accidental features. |
| `02-product-concepts.mmd` | Business vocabulary and relationships. Distinguishes editable cart choices from immutable accepted contents. Supporting conceptual model, not the detailed software design. |
| `03-order-lifecycle.mmd` | Legal progress, cancellation and terminal states. Gives staff and tracking one consistent lifecycle. |
| `04-product-rules.mmd` | Duplicate prevention, correction, stale information, private access and conflicting actions. Highlights guarantees shared across journeys. |
| `05-logical-architecture.mmd` | Browser UI, web backend/page delivery, controllers, access checks, services, policies, persistence handlers and durable information. Identifies runtime boundaries without choosing a framework, vendor or separately deployed services. |
| `06-detailed-design.mmd` | Detailed UI/controller/service/policy/storage responsibilities, entity/value information, operations and multiplicities. Establishes implementable contracts for the sequences, including staff access, durable acceptance and concurrent changes. |
| `S1-setup.mmd` | Repeatable setup and staff provisioning without duplicate data, resets or discarded order history. |
| `A1-menu.mmd` | CustomerView -> MenuController -> MenuService -> menu/configuration storage and OpeningPolicy. Makes closed/unavailable behavior part of the menu presentation. |
| `A2-cart.mmd` | CustomerView and Cart edits, corrections and recalculation. Keeps cart convenience separate from authoritative acceptance. |
| `A3-checkout.mmd` | Reviewed submission through controller, service, policy and stores. Validates current choices/hours and preserves exactly-one acceptance. |
| `A4-submission-recovery.mmd` | Recovery of a missing confirmation and safe resubmission through the same acceptance contract. Distinguishes an unknown result from rejection and prevents accidental second orders. |
| `A5-confirmation-link.mmd` | Known-acceptance presentation, purchased-cart clearing and link copying/saving. Separates confirmation usability from order creation and from C1's saved-link lookup. |
| `B1-queue.mmd` | Sign-in and authorization through identity handling, then queue refresh through OrderService/OrderStore. Shows failure, recovery and sign-out without prescribing an update transport. |
| `B2-detail.mmd` | Authorized detail retrieval, accepted history and return-to-filter behavior. Prevents rebuilding historical prices from today's menu. |
| `B3-transition.mmd` | Explicit action/cancellation, authorization, current-state/lifecycle checks and indivisible status/history change. Explains how stale actions are rejected without silently repeating them. |
| `C1-private-summary.mmd` | Private-link lookup and safe summary projection. Separates customer read access from staff powers and employee information. |
| `C2-tracking-refresh.mmd` | UpdateCoordinator and private reads with stale/recovery handling. Defines observable freshness without requiring polling or push. |
| `C3-instructions.mmd` | Private order lookup plus restaurant content and status-specific guidance. Keeps readiness/cancellation meaning consistent. |

## How to implement this design

The named classes are logical software responsibilities and contracts. Use framework-native handlers, functions, components or classes where appropriate; do not manufacture wrapper classes solely to match notation. Preserve the responsibilities and guarantees, and document the mapping to actual code. The class diagram is not a database schema. Named value types such as Money, Revision, CustomerContext and list types describe meaning without imposing a wire/storage representation. Shared stores in the architecture are persistence handlers, not mandatory additional servers.

The browser/backend boundary separates user interaction from authoritative acceptance and authorization. Views are not trusted sources of price, permission or order state. AccessService guards every staff read and write. Private links grant read access to one order, and public summaries exclude staff identity/access information.

CheckoutService owns acceptance orchestration and useful corrections; OrderStore's acceptOnce contract is the decisive indivisible acceptance boundary. An already accepted scoped submission returns the same confirmation before new-order checks. New acceptance uses current opening/menu information, preserves accepted values and creates exactly one order. Early rejection checks resolve racing acceptance before claiming failure. The attempt is bound to the reviewed selection; a definitive rejection closes it, while an unknown outcome can still be recovered. The agent chooses the storage/concurrency mechanism that enforces this contract.

OrderService owns status-change orchestration and OrderLifecycle defines legal changes. The final changeIfCurrent contract checks the observed revision and transition again at the change boundary and records the status plus employee/time history together. The view fixes the observed revision when the employee chooses an action; background refresh cannot silently replace it. Earlier reads are not a substitute for the final guarantee. Missing orders, stale changes, invalid actions and successful writes are distinct outcomes.

UpdateCoordinator describes current-information delivery, last-success state and recovery. It does not require a particular timer, protocol or library. Staff and tracking use the same logical behavior but different access paths. Reachability/access failure is never a successful refresh, and the coordinator does not automatically repeat staff writes.

## Consistency and precedence

The specification governs product behavior, and restaurant/menu content supplies concrete values. The architecture, detailed design and sequences govern logical responsibilities and interactions. Concept/state/rule diagrams are supporting views of the same product. Minor realization details remain autonomous implementation choices; do not remove a product guarantee to simplify a technical choice. Supplied inputs remain unchanged during implementation. Record concrete architecture/class mappings and actual verification in implementation outputs.
