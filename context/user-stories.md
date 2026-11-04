# User stories

## A. Customer ordering

| ID | Story | Required outcome |
|---|---|---|
| A1 | As a customer, I want to browse dishes and prices so I can choose a meal within my budget. | Names, descriptions, prices, availability and opening state are clear. Unavailable dishes cannot be added; closed ordering explains the next opening. |
| A2 | As a customer, I want to review and edit my cart so it contains the items and quantities I intend to buy. | Positive whole-number quantities, explicit removal, corrected invalid input and recalculated total. |
| A3 | As a customer, I want to submit my pickup order so the restaurant can prepare my meal. | Current prices/availability and opening time are checked. One accepted submission creates one Received order and returns its number/private link with copy/save guidance. Repeated attempts recover that result. |

## B. Restaurant order management

| ID | Story | Required outcome |
|---|---|---|
| B1 | As a restaurant employee, I want to see incoming and active orders so I can organize the kitchen's workload. | Authorized access, oldest-first filtered queue, automatic changes, last successful refresh and stale/recovery states. |
| B2 | As a restaurant employee, I want to inspect an order's contents so the kitchen prepares the correct meal. | Accepted item names, quantities, prices, order number and time remain correct after menu changes. |
| B3 | As a restaurant employee, I want to update order progress so staff and customers know its current state. | Valid lifecycle, required cancellation reason, employee/time history and deliberate recovery from concurrent conflicting actions. |

## C. Customer tracking

| ID | Story | Required outcome |
|---|---|---|
| C1 | As a customer, I want to open my order summary from its private link so I can confirm I am checking the correct order. | Direct browser access to only the associated order without login. Invalid links reveal no order. |
| C2 | As a customer, I want current status to update automatically so I can follow progress without calling. | Last successful check, clear warning on failed updates and current information on successful recovery. |
| C3 | As a customer, I want clear readiness or cancellation instructions so I can decide whether to collect the meal. | Ready shows pickup instructions/number; Cancelled shows reason/contact; other states do not incorrectly invite collection. |

The specification defines the business rules and alternate outcomes for these stories. Acceptance criteria define how to check them.
