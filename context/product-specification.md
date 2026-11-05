# Product specification

## Purpose and audience

Mesa Tica is a fictional single-restaurant pickup-ordering product. Customers choose food and know when to collect it; staff coordinate incoming orders and preparation.

Maya is comfortable ordering on her phone during a short lunch break. Luis coordinates kitchen work and needs clear, low-effort staff controls. Helen needs a readable saved-link experience with unmistakable collection guidance. `audience.md` describes these illustrative profiles and scenarios; `user-stories.md` defines customer ordering A1-A5, staff management B1-B3 and tracking C1-C3.

This specification defines product behavior. Restaurant content is in `restaurant-and-menu.md`, screen behavior and wording in `experience.md`, and completion criteria in `acceptance.md`. Product and logical software models in `design/` define the responsibilities and interactions that realize these requirements.

## Scope

One restaurant, immediate pickup orders, payment at collection, English interface, CRC prices. Prices include taxes and there are no extra checkout fees. Ordering is available to guests without signup. Staff access is restricted to provisioned authorized employees; both sample staff members have identical operational permissions.

Outside this product: customer accounts, delivery, online payment/refunds, scheduled orders, holiday overrides, multiple restaurants, menu/configuration-management screens, owner reporting, billing, inventory/stock counts, item sizes/extras/customization or special requests, preparation-time estimates, notifications outside the open page, status undo and lost-link recovery. No customer name, phone, email or address is collected to submit an order. Staff identify pickup by order number.

## A1: Browse the menu

Show the restaurant name, opening state, local hours, collection/payment explanation and menu. Each dish has a name, description, price and availability. Menu groups are presentation categories only. Unavailable dishes remain visible and clearly marked; they cannot be added. An empty menu says ordering is unavailable rather than appearing broken.

Customers may browse and prepare a cart while closed. Show the next opening in the restaurant's local time and disable submission while closed. The authoritative acceptance decision is the restaurant's current time, including if the page was left open across closing. If no upcoming opening exists in the configured weekly schedule, say the restaurant is currently closed and direct customers to its contact information; do not invent a reopening time.

## A2: Review the cart

Adding the same dish increases its quantity in one cart row. Quantities are positive whole numbers; invalid edits receive a correction and must not silently change to another quantity. Removal is explicit. Show each quantity, item price, line subtotal and total, with no fees beyond listed prices. Removing the final item returns an empty-cart state and disables submission.

Keep the cart when navigating around or reopening the same browser while local browser data remains available. No cross-device cart is promised. The displayed cart is a selection, not a reservation or price guarantee. Reopening/reviewing checks current availability/prices before an order can be accepted. After a known successful acceptance, empty the purchased cart; a subsequent intentional order starts a separate order. Existing tracking links remain valid.

## A3: Place a reviewed pickup order

Before submission show the chosen items, quantities, current total and payment-at-collection statement. Submission creates an immediate order, not a reservation awaiting staff acceptance. Accepted orders begin Received and have a unique order number and a private tracking link. Do not imply a preparation ETA. The acceptance result supplies the confirmation described in A5.

A submission is accepted only when nonempty, with valid quantities, available known dishes and current reviewed prices, during configured opening hours. A price change in either direction requires explicit customer review before acceptance. An unavailable/removed dish stays identified in the correction so the customer can remove it or choose something else; never silently substitute a dish or reduce quantity. Rejecting a submission creates no order and retains the cart. A changed-menu review requires a fresh explicit submit once corrections are made.

## A4: Recover an uncertain submission

An accepted submission creates exactly one order. Repeated attempts for that submission, including simultaneous attempts or a retry after a missing response, return confirmation for the same order. A retry of an already accepted submission succeeds even after closing or a later menu change. A new intentional order is separate. One customer's retry cannot reveal another customer's order.

If the outcome is uncertain, say so: do not claim rejection or success. Retain the pending order and offer Check order / Retry safely to recover the original result. Do not invite a fresh order or allow a changed cart to be submitted as though the earlier attempt certainly failed. Keep the attempt bound to the originally reviewed selection and recover it in the same browser. Before reporting rejection, resolve any competing acceptance of that attempt. A definitively rejected attempt cannot later become an order; corrected submission starts a new attempt. Once the original result is known, show its confirmation or the actionable rejection. Do not promise recovery after browser data is cleared or on another device without the saved tracking link.

## A5: Keep confirmation and tracking access

After a known acceptance, show the accepted contents/total, order number, Received status for a newly accepted order, and payment-at-collection instructions unless the order is already cancelled or collected. Recovery returns the same order identity and accepted contents; if its status has progressed, show current progress rather than reset it to Received. Empty the purchased cart only after acceptance is known. Provide Copy tracking link with success feedback, a selectable fallback if copying fails, and concise save/bookmark and link-privacy guidance. Saving a link does not create an order or require a customer account. Opening the saved private link is C1.

After acceptance, customers cannot edit or cancel orders in the app. The page explains this boundary; staff may cancel unfulfilled orders as below. No recovery by order number is provided when a private link is lost.

## B1: Staff access and queue

Staff sign in using provisioned credentials and can sign out. Failed sign-in has a clear generic correction without revealing whether a particular account exists. No public staff registration or account-management screens are required. Distinguish a failed connection or service timeout from rejected credentials. On access expiry, explain that sign-in is required; reauthenticate before viewing or changing orders.

The default queue contains Received, Preparing and Ready orders, oldest submission first with a stable order-number tie-break. Filters: Active (default), each of the five statuses, and All. Collected/Cancelled disappear from Active after a confirmed update but remain reachable through filters. Opening an order and returning preserves the chosen filter. Empty filtered results say no orders match that filter.

New matching orders and status changes appear automatically while the page is open, including status changes made by another staff member. Preserve the chosen filter. Show last successful refresh time, not simply the last order's change time. Refresh failure leaves the last known information visible with a clear stale warning; a successful recovery fetches current information and clears it. Never label stale data as current.

## B2: Inspect an order

Show the unique order number, submission time in restaurant-local time, accepted item names/quantities/prices, line subtotals, total and current status. These accepted values never change when the menu is later edited or removed. No customer contact details are needed. Staff may inspect all retained statuses. Show cancellation reason on cancelled orders and staff-attributed times for accepted status changes in order detail; this history is for staff, not the public tracking page.

## B3: Coordinate progress

Only authorized staff may perform these transitions:

| Current | Allowed next actions |
|---|---|
| Received | Mark Preparing; Cancel order |
| Preparing | Mark Ready; Cancel order |
| Ready | Mark Collected; Cancel order |
| Collected | None |
| Cancelled | None |

Mark Collected means staff have handed the order to the customer; payment happens outside the application and is not tracked separately. Cancel requires a nonblank, non-whitespace reason and an explicit final confirmation. Explain that the reason will be shown to the customer. The reason describes inability to fulfill the order; do not request private personal information. Cancelling the confirmation changes nothing and retains the typed reason while that detail view remains open.

Record the responsible employee and time for every accepted staff change. If two authorized employees submit individually valid competing changes from the same previously observed state, exactly one change succeeds; the other receives the current state and an explanation. Bind each action to the revision visible when the employee chooses it. Background refresh must not change that revision while the action is in progress. A still-valid next action requires a new deliberate choice against the refreshed state. Never automatically resubmit a rejected change or silently overwrite another employee's work.

A temporarily unavailable/stale detail view makes no claims that a change succeeded. Preserve an entered cancellation reason, refresh current state and require deliberate recovery before another attempt. If a write's outcome is uncertain, refresh the actual state/history; do not automatically repeat the action. Collected and Cancelled are final: no skipping, reversal or reopening. Staff may finish accepted orders after closing. No automatic expiry, auto-cancellation or deletion of old active orders occurs.

## C1-C3: Private tracking and collection

A saved private link opens only its associated order in a browser without signing in or installing an app. It can be reopened on another device by its holder. Anyone with that link can view that order: tell customers to keep it private. Order numbers identify pickup, but do not independently grant online access. Missing/invalid links disclose no order information and do not distinguish guessed order numbers. A timeout or service failure is an unavailable update, not evidence the link is invalid. No lost-link search or public order directory exists.

Show accepted contents/total, order number, submission time and current status. Automatically update the open page and show the last successful check. Failed updates keep the last known status visible with an unmistakable warning that it may be out of date. When connectivity returns, obtain current information before clearing the warning. Stale Ready data must also display the warning; it is not a new confirmation to collect.

| Status | Customer meaning / next step |
|---|---|
| Received | Order received by the restaurant; not ready for pickup. |
| Preparing | Kitchen is preparing the meal; not ready for pickup. |
| Ready | Ready for pickup; show order number, collection instructions, pickup location and payment-at-collection statement. |
| Collected | Order has been handed over; no further pickup action. |
| Cancelled | Order will not be prepared/collected; show the exact staff-provided reason and restaurant contact information. |

Do not expose staff identities or internal account details through tracking. Keep existing private links usable after an order becomes Collected or Cancelled. Private tracking links contain at least 128 bits of random entropy.

## Restaurant configuration and startup responsibilities

The finished app must be runnable from documented setup, preserve orders/status/history across application restarts, load the provided fictional restaurant/menu, and make at least two staff accounts available through a safe documented setup process. Repeating setup must not duplicate menu data, reset existing passwords or delete orders. No passwords or live credentials are supplied. Local setup must be usable without asking for credentials: generate local-only access or provide a documented noninteractive provisioning path, and explain how to sign in without committing passwords.

Opening schedule: the supplied restaurant-local weekly hours, opening inclusive and closing exclusive. No overnight hours or holiday exceptions are required. Staff may finish previously accepted orders after close. Dates, hours and messages refer to America/Costa_Rica for the supplied restaurant; opening decisions follow that configured time zone, not the visitor's device zone. Show next-opening weekday and local time, including the date when needed to prevent ambiguity.

## Implementation freedom and completion

Implement the logical architecture, responsibilities, interactions and guarantees in `design/`. The implementation chooses concrete runtime organization, language, framework, data representation/technology, authentication mechanism, routes, identifiers, update transport, concurrency/retry algorithms, dependencies, deployment and visual implementation. Logical classes can map to framework-native constructs; no particular library or vendor is required.

Deliver the end-to-end product, not a static mockup or fabricated order workflow. Verify against `acceptance.md`, document actual setup and deployment steps, and distinguish measured outcomes from targets. Local operation must not require an existing hosted account, external-service credential or purchased asset. Deployment documentation can describe account-dependent steps separately.
