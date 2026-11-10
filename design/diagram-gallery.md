# Diagram gallery

This page renders the canonical Mermaid sources for review. The `.mmd` files remain authoritative; refresh this gallery when their sources change. For the complete class model, use the [four readable class views](class-views.md) and [full source](diagrams/06-detailed-design.mmd). Descriptions and logical-design contracts are in the [design guide](README.md).

## 01-context

[Source](diagrams/01-context.mmd)

```mermaid
flowchart LR
    Customer["Guest customer: Maya / Helen"]
    Staff["Authorized employee: Luis"]
    Setup["Restaurant setup: menu, hours and staff access"]
    Physical["Cooking, handoff and payment outside the app"]
    subgraph Product["Mesa Tica pickup ordering"]
        Ordering["A · Customer ordering<br/>Browse, edit cart and place order<br/>A1–A5"]
        Operations["B · Restaurant operations<br/>Queue, order details and status changes<br/>B1–B3"]
        Tracking["C · Customer tracking<br/>Private link, status and pickup guidance<br/>C1–C3"]
    end
    Customer --> Ordering
    Customer --> Tracking
    Staff --> Operations
    Setup --> Product
    Ordering -->|"Accepted order"| Operations
    Operations -->|"Current status"| Tracking
    Staff -.-> Physical
    Customer -.->|"Collect and pay"| Physical
```

## 02-product-concepts

[Source](diagrams/02-product-concepts.mmd)

```mermaid
classDiagram
    class Restaurant {
        name
        localOpeningHours
        pickupLocation
        pickupInstructions
        contactInformation
    }
    class MenuItem {
        name
        description
        group
        displayOrder
        price
        availability
    }
    class Cart {
        selectedItems
        displayedTotal
    }
    class CartItem {
        dish
        quantity
        reviewedPrice
    }
    class Order {
        uniqueNumber
        submissionTime
        acceptedContents
        acceptedTotal
        currentStatus
        privateTrackingLink
    }
    class OrderedItem {
        acceptedName
        quantity
        acceptedUnitPrice
        acceptedSubtotal
    }
    class StatusChange {
        previousStatus
        newStatus
        employee
        time
        cancellationReason
    }
    class Employee {
        displayName
        authorizedAccess
    }
    Restaurant "1" --> "0..*" MenuItem : offers
    Cart "1" --> "0..*" CartItem : contains
    CartItem --> MenuItem : selects
    Cart --> Order : accepted submission creates
    Order "1" --> "1..*" OrderedItem : preserves
    Order "1" --> "0..*" StatusChange : records staff changes
    Employee "1" --> "0..*" StatusChange : performs
    note for Order "Conceptual product information. Detailed software responsibilities are<br/>defined in the logical design, with concrete representation chosen during<br/>implementation."
    note for OrderedItem "Accepted names and prices remain unchanged when the menu changes."
```

## 03-order-lifecycle

[Source](diagrams/03-order-lifecycle.mmd)

```mermaid
stateDiagram-v2
    [*] --> Received: accepted guest order
    Received --> Preparing: employee starts preparation
    Preparing --> Ready: employee confirms ready
    Ready --> Collected: employee confirms handoff
    Received --> Cancelled: employee confirms cancellation with reason
    Preparing --> Cancelled: employee confirms cancellation with reason
    Ready --> Cancelled: employee confirms cancellation with reason
    Collected --> [*]
    Cancelled --> [*]
    note right of Received
        Only authorized staff change status.
        Accepted changes record employee and time.
        Reject stale/conflicting actions and show current state.
        A new attempt requires deliberate staff review.
    end note
    note right of Cancelled
        Collected and Cancelled are final.
        No customer edits/cancellation, undo or reopening.
    end note
```

## 04-product-rules

[Source](diagrams/04-product-rules.mmd)

```mermaid
flowchart TB
    Review["Customer reviews selected dishes, quantities and total"] --> Check["Check valid items/quantities, current prices/availability and opening hours"]
    Check -->|"Correction needed"| Correct["Explain correction, keep cart, create no order"]
    Check -->|"Valid new submission"| Accept["Accept exactly one Received order; preserve contents/total; provide number and private link"]
    Retry["Repeat the same submission after missing confirmation"] --> Recover["Recover same accepted result, including after closing; never create a duplicate"]
    Conflict["Two staff actions based on the same observed order state"] --> One["Accept one; reject the stale action; show current state and require deliberate review"]
    Link["Private tracking link"] --> Associated["Show only associated order; no order-number search or public directory"]
    Lost["Updates unavailable"] --> Stale["Keep last known information/time and show warning; clear only after successful refresh"]
    note1["Mechanisms for retries, access control, updates, persistence and conflict handling are implementation choices."]
    note1 -.-> Accept
```

## 05-logical-architecture

[Source](diagrams/05-logical-architecture.mmd)

```mermaid
flowchart TB
    subgraph Browser["Browser frontend"]
        Customer["A · CustomerView<br/>Menu, cart and confirmation"]
        Staff["B · StaffView<br/>Sign-in, queue and detail"]
        Tracking["C · TrackingView<br/>Private progress and guidance"]
        Updates["UpdateCoordinator<br/>Current data, last success and recovery"]
        Staff --> Updates
        Tracking --> Updates
    end
    subgraph Backend["Web backend runtime"]
        Delivery["Page and asset delivery"]
        AControllers["A · MenuController / OrderController"]
        BControllers["B · AuthController / StaffOrderController"]
        CController["C · TrackingController"]
        Access["AccessService<br/>Staff identity and authorization"]
        AServices["A · MenuService / CheckoutService"]
        BService["B · OrderService"]
        CService["C · TrackingService"]
        Policies["OpeningPolicy / OrderLifecycle<br/>Business decisions"]
        Stores["Data layer · MenuStore / RestaurantStore<br/>OrderStore / IdentityStore"]
        AControllers --> AServices
        BControllers --> Access
        BControllers --> BService
        CController --> CService
        AServices --> Policies
        BService --> Policies
        AServices --> Stores
        BService --> Stores
        CService --> Stores
        Access --> Stores
    end
    Durable[("Durable data<br/>Restaurant and menu, accepted orders and lines,<br/>submissions, status history and staff access")]
    Setup["SetupRunner<br/>Repeatable setup and staff provisioning"]
    Browser -->|"Pages and assets"| Delivery
    Customer -->|"Browse, submit and recover"| AControllers
    Staff -->|"Sign in, inspect and change status"| BControllers
    Tracking -->|"Open private link"| CController
    Updates -->|"Current authorized queue or detail"| BControllers
    Updates -->|"Current private snapshot"| CController
    Stores --> Durable
    Setup --> Stores
    Boundary["Request boundaries<br/>Validate representation and values, preserve access checks,<br/>distinguish client errors from service failure"]
    Boundary -.-> AControllers
    Boundary -.-> BControllers
    Boundary -.-> CController
```

## A1-menu

[Source](diagrams/A1-menu.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as CustomerView
    participant C as MenuController
    participant S as MenuService
    participant M as MenuStore
    participant R as RestaurantStore
    participant P as OpeningPolicy
    Customer->>UI: Open menu
    UI->>C: getMenu(context)
    C->>S: getMenu(now)
    S->>M: readCurrentMenu()
    M-->>S: Dish names, descriptions, prices and availability
    S->>R: readRestaurant()
    R-->>S: Hours, timezone and pickup information
    S->>P: isOpen(restaurant, now) and nextOpening(restaurant, now)
    P-->>S: Opening state and next opening if any
    S-->>C: Menu presentation
    C-->>UI: Menu and opening information
    UI-->>Customer: Browse grouped dishes and prices
    alt Dish available
    Customer->>UI: Add dish
    UI->>UI: Increase cart quantity
    else Dish unavailable
    UI-->>Customer: Explain unavailable, no addition
    end
    opt Restaurant closed
    alt Next opening known
    UI-->>Customer: Cart editable, disabled button shows next local opening
    else No upcoming opening
    UI-->>Customer: Cart editable, ordering closed, show contact
    end
    end
```

## A2-cart

[Source](diagrams/A2-cart.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as CustomerView
    participant Cart as Cart
    Customer->>UI: Review or edit cart
    alt Valid positive whole-number quantity
    UI->>Cart: changeQuantity(item, quantity)
    else Invalid quantity
    UI-->>Customer: Correction near affected item, no silent coercion
    end
    opt Explicit removal chosen
    UI->>Cart: remove(item)
    end
    UI->>Cart: calculateTotal()
    Cart-->>UI: Current selected quantities, subtotals and total
    UI-->>Customer: Updated review
    opt Cart empty
    UI-->>Customer: Empty-cart guidance, cannot submit
    end
    Note over UI,Cart: Cart continuity stays within the same browser. Server-side acceptance still checks every submitted choice.
```

## A3-checkout

[Source](diagrams/A3-checkout.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as CustomerView
    participant Cart as Cart
    participant C as OrderController
    participant S as CheckoutService
    participant O as OrderStore
    participant M as MenuStore
    participant R as RestaurantStore
    participant P as OpeningPolicy
    Customer->>UI: Place reviewed pickup order
    UI->>UI: reviewAndSubmit()
    alt New submission
    UI->>UI: beginAttempt()
    UI->>UI: savePending()
    else Attempt pending
    UI->>UI: recoverPending()
    end
    Note over UI: Save this attempt and its reviewed selection for same-browser recovery. Do not submit a different selection under it.
    UI->>C: submit(context, attempt, selection)
    C->>S: accept(context, attempt, selection)
    S->>O: findAccepted(context, attempt)
    alt Attempt already accepted
    O-->>S: Original order and its recorded selection
    Note over S,O: Return the same order even after closing. A different selection is not ordered.
    else Acceptance not yet established
    S->>M: readCurrentMenu()
    S->>R: readRestaurant()
    S->>P: isOpen(restaurant, now)
    opt Restaurant closed
    S->>P: nextOpening(restaurant, now)
    end
    S->>S: validateSelection(selection, menu)
    alt Closed or correction needed
    S->>O: resolveRejectedAttempt(context, attempt)
    O-->>S: Prior acceptance, closed attempt with correction, or unresolved
    Note over S,O: Resolve any competing acceptance before reporting rejection. A closed attempt cannot later be accepted.
    else Selection valid
    S->>O: acceptOnce(context, attempt, selection, proposal)
    opt New order accepted
    O->>O: issuePrivateLink()
    end
    O-->>S: New or prior acceptance, rejection, or unresolved
    Note over S,O: Recheck acceptance conditions and record at most one order with immutable contents. Issue the private link only for a new order. The implementation chooses how to make this decision indivisible.
    end
    end
    opt Result is accepted
    S->>S: buildConfirmation(order)
    end
    S-->>C: Actual result
    alt Known acceptance
    C-->>UI: Confirmation
    UI-->>Customer: Show accepted order under A5 and explain if a different selection was not ordered
    else Known rejection
    C-->>UI: Correction or closing information
    UI->>UI: clearPending()
    UI->>Cart: applyCorrection(correction)
    UI-->>Customer: Keep cart and explain correction, next opening or contact
    else Unresolved or response unavailable
    UI-->>Customer: Outcome uncertain, recover this attempt under A4
    end
    Note over UI,Cart: Keep unavailable items identified and preserve unrelated choices. A corrected deliberate submission starts a new attempt.
```

## A4-submission-recovery

[Source](diagrams/A4-submission-recovery.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as CustomerView
    participant Cart as Cart
    participant C as OrderController
    participant S as CheckoutService
    participant O as OrderStore
    Customer->>UI: Return to an attempt with missing confirmation
    UI->>UI: recoverPending()
    alt No saved attempt
    UI-->>Customer: No recovery promised, saved tracking link still works
    else Pending attempt found
    UI-->>Customer: Outcome uncertain, recover this attempt before a new order
    Customer->>UI: Check order
    UI->>C: recover(context, attempt)
    C->>S: recover(context, attempt)
    S->>O: readAttemptOutcome(context, attempt)
    alt Acceptance found
    O-->>S: Original order, including after closing
    S->>S: buildConfirmation(order)
    S-->>C: Original accepted result
    C-->>UI: Confirmation for A5
    UI-->>Customer: Original order found
    else Definitive rejection already recorded
    O-->>S: Closed attempt and original correction
    S-->>C: Definitive rejection and correction
    C-->>UI: Correction, not an uncertain outcome
    UI->>UI: clearPending()
    UI->>Cart: applyCorrection(correction)
    UI-->>Customer: Keep cart, explain correction, deliberate corrected submit starts a new attempt
    else Acceptance not established
    O-->>S: No accepted record, outcome remains uncertain
    S-->>C: Unresolved
    C-->>UI: Keep pending attempt and reviewed selection
    UI-->>Customer: Offer safe retry of the same attempt
    Customer->>UI: Retry safely
    UI->>C: submit(context, attempt, selection)
    C->>S: accept(context, attempt, selection)
    Note over S,O: Follow the complete A3 acceptance path using the original selection. No different order is created for this attempt.
    alt Accepted
    S-->>C: Same accepted order
    C-->>UI: Confirmation for A5
    UI-->>Customer: Order confirmed
    else Definitive rejection
    S-->>C: Correction and closed attempt
    C-->>UI: Correction
    UI->>UI: clearPending()
    UI->>Cart: applyCorrection(correction)
    UI-->>Customer: Keep cart and explain the correction
    else Still unresolved or response unavailable
    UI-->>Customer: Remain uncertain and retain the pending attempt
    end
    else Check unavailable
    UI-->>Customer: Remain uncertain and offer recovery again
    end
    end
    Note over UI,O: Recovery reveals no other customer's order. A corrected deliberate submission starts a new attempt only after rejection is known.
```

## A5-confirmation-link

[Source](diagrams/A5-confirmation-link.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 240, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as CustomerView
    participant Cart as Cart
    participant Tracking as TrackingView
    Note over Customer,UI: Begins only with a known acceptance result from A3 or A4. No new order is submitted here.
    UI->>UI: showConfirmation(confirmation)
    alt Status Received
    UI-->>Customer: Order received, accepted number, items/total, status and pay-at-collection guidance
    else Recovered order has progressed
    UI-->>Customer: Same number and items/total, current status and its next step, pay-at-collection guidance unless collected, not reset to Received
    else Recovered order was cancelled
    UI-->>Customer: Same number and items/total, this order was cancelled, view progress for the reason and contact under C3, no invitation to collect or pay
    end
    UI->>UI: retainConfirmation(confirmation)
    alt Browser storage available
    UI->>UI: Save known acceptance and private link before clearing pending recovery
    UI->>UI: clearPending()
    else Browser storage unavailable
    UI->>UI: Keep pending recovery information if confirmation could not be saved
    UI-->>Customer: Keep this confirmation open, copy or bookmark link before leaving
    end
    UI->>Cart: clearPurchased(selection)
    UI-->>Customer: View progress and save/bookmark instructions, keep link private
    Customer->>UI: Copy tracking link
    UI->>UI: copyTrackingLink()
    alt Copy succeeds
    UI-->>Customer: Link copied feedback
    else Copy unavailable
    UI-->>Customer: Selectable private link and manual-copy instructions
    end
    opt Reload or return to same tab with saved confirmation
    UI->>UI: restoreConfirmation()
    UI->>Tracking: Open saved private link, no submission
    Note over Customer,Tracking: C1/C2 retrieve current progress, cached status is last known, failures retain link and stale warning
    end
    Note over Customer,UI: A recovered order keeps its original identity and accepted contents. Do not reset its current status. C1 defines opening the saved link.
```

## B1-queue

[Source](diagrams/B1-queue.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Employee
    participant UI as StaffView
    participant A as AuthController
    participant Access as AccessService
    participant I as IdentityStore
    participant U as UpdateCoordinator
    participant C as StaffOrderController
    participant S as OrderService
    participant O as OrderStore
    Employee->>UI: Sign in
    UI->>UI: signIn()
    UI->>A: signIn(credentials)
    A->>Access: signIn(credentials)
    alt Excessive sign-in attempts temporarily limited
    Access-->>A: Temporarily limited, generic retry guidance
    A-->>UI: Sign-in temporarily unavailable, retry guidance
    UI-->>Employee: Explain when or how to retry, no account existence or order data disclosed
    else Sign-in attempt permitted
    Access->>I: authenticate(credentials)
    I-->>Access: Access context or generic failure
    Access-->>A: Sign-in outcome
    alt Sign-in failed
    A-->>UI: Actual sign-in outcome
    UI-->>Employee: Generic correction, no order data
    else No response before timeout, or service failure
    UI-->>Employee: Could not reach sign-in, try again, credentials not blamed, no order data
    else Authorized access available
    A-->>UI: Actual sign-in outcome
    UI->>U: observe(target, view)
    Note over UI,U: The target is the queue with the chosen filter. Active is the default.
    loop Automatic refresh while queue open
    opt Employee chooses a filter
    Employee->>UI: Choose filter
    UI->>U: observe(target, view)
    end
    U->>U: refresh(target)
    alt Connection and service available
    U->>C: listQueue(context, filter)
    C->>Access: requireStaff(context)
    Access->>I: resolveAccess(context)
    I-->>Access: Current identity and authorization
    alt Authorized
    Access-->>C: Employee
    C->>S: listQueue(filter)
    S->>O: listOrders(filter)
    O-->>S: Matching orders oldest first with stable tie-break, or none
    S-->>C: Queue snapshot
    C-->>U: Successful current information
    U-->>UI: Preserve filter, update successful check, clear stale warning
    UI->>UI: showQueue(orders)
    alt Orders match the filter
    UI-->>Employee: Queue oldest first, last successful refresh time
    else No orders match
    UI-->>Employee: No active orders on the default filter, otherwise no orders match this filter, with last successful refresh time, distinct from a failed load
    end
    else Access denied or expired
    Access-->>C: Denial without staff data
    C-->>U: Sign-in required or access denied
    U-->>UI: Stop protected updates and explain access state
    UI-->>Employee: Sign-in required or access denied, no order data
    end
    else No response before timeout, or refresh fails for connection or service reasons
    U-->>UI: Keep prior data/time, show stale warning
    UI-->>Employee: Last known queue and refresh time with stale warning, or a failed-load state if nothing has loaded yet
    opt Connection recovers with valid access
    UI->>U: recover(target)
    U->>U: refresh(target)
    U-->>UI: Clear warning only after successful current information
    UI-->>Employee: Current queue and refresh time, warning cleared
    end
    end
    end
    opt Employee signs out
    Employee->>UI: Sign out
    UI->>UI: signOut()
    UI->>A: signOut(context)
    A->>Access: signOut(context)
    Access->>I: revokeAccess(context)
    Access-->>A: Signed out
    alt Sign-out confirmed
    A-->>UI: Actual sign-out outcome
    UI->>U: stop(target)
    UI-->>Employee: Signed out, no order data
    else No response before timeout
    UI-->>Employee: Sign-out not confirmed, try again
    end
    end
    end
    end
```

## B2-detail

[Source](diagrams/B2-detail.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Employee
    participant UI as StaffView
    participant U as UpdateCoordinator
    participant C as StaffOrderController
    participant Access as AccessService
    participant S as OrderService
    participant O as OrderStore
    participant L as OrderLifecycle
    Employee->>UI: Open order
    UI->>U: observe(target, view)
    loop Automatic refresh while detail open
    U->>U: refresh(target)
    alt Connection and service available
    U->>C: getDetail(context, number)
    C->>Access: requireStaff(context)
    alt Access denied or expired
    Access-->>C: Denial
    C-->>U: No order data, access guidance
    U-->>UI: Stop protected updates and explain access state
    UI-->>Employee: Sign-in required or access denied, no order data, typed reason kept
    else Authorized employee
    Access-->>C: Employee
    C->>S: getDetail(number)
    S->>O: readOrder(number)
    alt Order found
    O-->>S: Accepted lines/total, submission time, status/revision and staff history
    S->>L: allowedActions(status)
    L-->>S: Permitted actions for this state
    S-->>C: Detail and permitted actions
    C-->>U: Current detail
    U-->>UI: Newest response only, update successful check, clear stale warning, advance observedRevision unless an action is in progress
    UI->>UI: showDetail(order)
    UI-->>Employee: Accepted values, local time, history and actions, draft reason kept
    Note over UI: Keep observedRevision for conflict handling and hide its internal value from staff.
    else Order not found
    O-->>S: Not found
    S-->>C: Unavailable order
    C-->>U: Unavailable order
    U-->>UI: Explain unavailable, allow return to queue
    UI-->>Employee: Order unavailable, return to queue offered
    end
    end
    else No response before timeout, or refresh fails for connection or service reasons
    U-->>UI: Keep prior detail/time, show stale warning
    UI-->>Employee: Last known detail may be out of date, draft reason kept, no claim that a change succeeded
    opt Connection recovers with valid access
    UI->>U: recover(target)
    U->>U: refresh(target)
    U-->>UI: Clear warning only after successful current information
    UI-->>Employee: Current detail, warning cleared
    end
    end
    end
    Note over UI,O: Never reconstruct accepted names/prices from today's menu. Detail updates use the same authorized refresh path and retain draft input. observedRevision advances to the revision of each newer detail shown, unless an action is in progress under B3. A response older than the detail shown is ignored.
    Employee->>UI: Return to queue
    UI->>U: stop(target)
    UI-->>Employee: Previous selected filter
```

## B3-transition

[Source](diagrams/B3-transition.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Employee
    participant UI as StaffView
    participant C as StaffOrderController
    participant Access as AccessService
    participant S as OrderService
    participant L as OrderLifecycle
    participant O as OrderStore
    Employee->>UI: Choose permitted next action
    Note over UI: Use the revision the employee saw when choosing the action. Refresh must not silently change it during confirmation.
    break Detail is stale
    UI-->>Employee: Refresh before acting, keep any typed reason
    end
    opt Cancellation chosen
    UI-->>Employee: Request customer-visible reason and final confirmation
    Employee->>UI: Enter reason and confirm or dismiss
    end
    alt Cancellation dismissed
    UI-->>Employee: No change, retain reason in current view
    else Action submitted
    UI->>UI: requestChange(target, reason)
    UI->>C: changeStatus(context, number, revision, target, reason)
    C->>Access: requireStaff(context)
    alt Access denied
    Access-->>C: Denial
    C-->>UI: No change, sign-in or access guidance
    UI-->>Employee: Hide protected detail and retain same-order cancellation draft
    Note over Employee,UI: Reauthenticate through B1, then fetch current detail through B2. Restore the draft only for this order and require a new deliberate action. Never resend automatically.
    else Authorized
    Access-->>C: Employee
    C->>S: changeStatus(number, revision, target, reason, employee)
    S->>O: readOrder(number)
    alt Order unavailable
    O-->>S: Not found
    S-->>C: Unavailable order
    else Order found
    O-->>S: Current detail and revision
    alt Already stale
    S-->>C: Conflict and current detail
    else Current revision
    S->>L: validateChange(status, target, reason)
    alt Invalid action or reason
    L-->>S: Correction
    S-->>C: Rejected, no change
    else Action valid
    L-->>S: Proposed transition permitted
    S->>O: changeIfCurrent(number, revision, target, reason, employee)
    Note over S,O: Check revision and transition at the decision boundary. Save status and employee/time history together. Only one change from the same revision can succeed.
    alt Stale revision
    O-->>S: Conflict and current detail
    S-->>C: No change, explain conflict
    else Accepted
    O-->>S: Updated detail and history
    S-->>C: Accepted change
    end
    end
    end
    end
    C-->>UI: Actual outcome
    opt Conflict
    UI->>UI: showConflict(currentOrder)
    end
    UI-->>Employee: Result or correction, review before another action
    end
    end
    opt Write outcome uncertain
    UI->>C: getDetail(context, number)
    C-->>UI: Current state and history, or unavailable
    UI-->>Employee: Review before a new deliberate action, no automatic retry
    end
```

## C1-private-summary

[Source](diagrams/C1-private-summary.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as TrackingView
    participant C as TrackingController
    participant S as TrackingService
    participant O as OrderStore
    Customer->>UI: Open saved private link
    UI->>C: getSummary(privateLink)
    alt Connection and service available
    C->>S: getSnapshot(privateLink)
    S->>O: findByPrivateLink(privateLink)
    alt Valid link
    O-->>S: Associated accepted order
    S-->>C: Public summary, excluding employee identities/access details
    C-->>UI: Safe order snapshot
    UI->>UI: showSummary(snapshot)
    UI-->>Customer: Recognizable number, submission time, accepted items/total and status
    else Missing or invalid link
    O-->>S: No accessible order
    S-->>C: Generic unavailable result, no order data
    C-->>UI: Link guidance, no numeric lookup
    UI->>UI: showUnavailable()
    UI-->>Customer: We couldn't open this tracking link, check the full saved link, no order details
    end
    else No response before timeout, or connection or service failure
    UI-->>Customer: Updates are unavailable, no fabricated status or last-checked time, not reported as an invalid link
    end
    Note over Customer,O: Possession grants read access to this order only, not staff operations. No customer login or app installation.
```

## C2-tracking-refresh

[Source](diagrams/C2-tracking-refresh.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as TrackingView
    participant U as UpdateCoordinator
    participant C as TrackingController
    participant S as TrackingService
    participant O as OrderStore
    Customer->>UI: Leave private tracking page open
    UI->>U: observe(target, view)
    loop Automatic refresh while page open
    U->>U: refresh(target)
    alt Connection and service available
    U->>C: getSummary(privateLink)
    C->>S: getSnapshot(privateLink)
    S->>O: findByPrivateLink(privateLink)
    O-->>S: Associated current order or unavailable
    S-->>C: Safe snapshot with its status-specific guidance, or unavailable
    alt Successful current snapshot
    C-->>U: Current information
    U-->>UI: Render current status, update successful time, clear warning
    UI->>UI: showSummary(snapshot)
    UI->>UI: showInstructions(snapshot)
    UI-->>Customer: Current status, its next step and last successful check
    else Invalid link
    C-->>U: Link unavailable without order data
    U-->>UI: Show unavailable-link state, no invented status
    UI->>UI: showUnavailable()
    UI-->>Customer: We couldn't open this tracking link, check the full saved link, no order details
    end
    else No response before timeout, or connection or service failure
    U-->>UI: Keep last information/time and mark stale
    UI-->>Customer: Status may be outdated, no fabricated first-load result
    opt Connectivity returns
    UI->>U: recover(target)
    U->>U: refresh(target)
    U-->>UI: Clear warning only after successful current information
    UI-->>Customer: Current status, its next step and last successful check, warning cleared
    end
    end
    end
    Note over UI,U: Choose the update transport and verify freshness end to end without erasing active input.
```

## C3-instructions

[Source](diagrams/C3-instructions.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Customer
    participant UI as TrackingView
    participant C as TrackingController
    participant S as TrackingService
    participant O as OrderStore
    participant R as RestaurantStore
    Customer->>UI: View order progress
    UI->>C: getSummary(privateLink)
    alt Connection and service available
    C->>S: getSnapshot(privateLink)
    S->>O: findByPrivateLink(privateLink)
    alt Link unavailable
    O-->>S: No accessible order
    S-->>C: Generic unavailable result
    C-->>UI: No order information
    UI->>UI: showUnavailable()
    UI-->>Customer: We couldn't open this tracking link, check the full saved link, no order details
    else Valid associated order
    O-->>S: Accepted order/status and cancellation reason if any
    S->>R: readRestaurant()
    R-->>S: Pickup instructions, location and contact
    S->>S: collectionGuidance(order, restaurant)
    alt Received or Preparing
    S-->>C: Not ready for pickup
    else Ready
    S-->>C: Number, pickup instructions, pickup location and payment-at-collection
    else Cancelled
    S-->>C: Customer-visible reason and labeled contact
    else Collected
    S-->>C: Collected, no further pickup action
    end
    C-->>UI: Safe summary and matching guidance
    UI->>UI: showInstructions(snapshot)
    UI-->>Customer: Status-specific next step
    end
    else No response before timeout, or connection or service failure
    UI-->>Customer: Updates are unavailable, no fabricated status, pickup guidance or last-checked time
    end
    Note over UI,S: Existing stale warning remains until a successful current read. No preparation ETA or extra notification requirement.
```

## S1-setup

[Source](diagrams/S1-setup.mmd)

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 200, "actorMargin": 35}}}%%
sequenceDiagram
    autonumber
    actor Operator
    participant Run as SetupRunner
    participant R as RestaurantStore
    participant M as MenuStore
    participant I as IdentityStore
    Operator->>Run: Run documented noninteractive setup
    Run->>Run: runSetup()
    Run->>R: loadRestaurantIfAbsent(restaurant)
    R-->>Run: Restaurant details available, existing values preserved
    Run->>M: loadMenuIfAbsent(menu)
    M-->>Run: Menu available without duplicate entries
    loop Each sample employee, at least two distinguishable accounts
    Run->>I: provisionEmployee(profile, credentials)
    I-->>Run: Staff account available, existing credentials unchanged
    end
    Run-->>Operator: Local run, sign-in and configurable hosting/storage instructions
    Note over Operator,Run: Choose address, port, durable storage and HTTPS session settings without source edits. Local run needs no hosted account. Verify restart with configured storage, a listener check is not live deployment.
    Note over Operator,I: Initial setup creates no customer orders. Repeated setup preserves orders and history. Use isolated test data to exercise open, closed and changed-menu cases. Normal ordering always applies configured hours.
```
