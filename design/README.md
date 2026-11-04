# Product models

These models describe product boundaries, concepts, lifecycle and interactions.

| Model | Purpose |
|---|---|
| `01-context.mmd` | Customers, staff, product sections and physical cooking/pickup/payment outside the application. |
| `02-product-concepts.mmd` | Meanings and relationships of menu items, selected/accepted quantities, orders and status changes. The class notation is conceptual, not a mandatory schema or code structure. |
| `03-order-lifecycle.mmd` | Legal transitions and final statuses. |
| `04-product-rules.mmd` | Shared observable rules for acceptance, conflicts, tracking and interrupted connections. |
| Nine `A1`-`C3` sequences | One business-level sequence per user story, showing actor/system behavior and important alternate outcomes. No fixed APIs, controllers, storage mechanisms or transport are specified. |

The specification defines behavior; these conceptual models make it easier to review. They do not prescribe software architecture or code structure.
