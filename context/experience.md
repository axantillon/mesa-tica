# Product experience and wording

This document defines information, actions and outcome clarity, not a visual layout, component library or technical navigation scheme. The agent chooses visual design and implementation. Example wording may be polished while preserving its meaning.

## Menu and cart - Maya

Make restaurant identity, opening state, pickup/payment policy and prices understandable before ordering. Keep cart access and its total easy to find. Each dish exposes name, description, price and an Add action only when available. Unavailable dishes remain identifiable. Customers can prepare a cart while closed, but the disabled submission action explains when ordering resumes.

Cart rows show item, price, quantity, subtotal and explicit Remove. Display the exact total without invented fees. Submission is an explicit “Place pickup order” action after review. Prevent repeated taps from looking like separate new orders. An empty cart says “Your cart is empty” and guides the customer back to the menu.

| State | Message meaning and available action |
|---|---|
| Closed | “Ordering is closed. Opens [weekday/date, local time].” Browsing/cart editing allowed; placing an order unavailable. |
| Invalid quantity | “Enter a whole number greater than zero.” Keep the correction near the affected item; do not silently remove it. |
| Price changed | “[Dish] is now [price]. Review your updated total before placing the order.” Require review and explicit submission. |
| Item unavailable | “[Dish] is no longer available. Remove it or choose another item.” Keep the rest of the cart. |
| Submission in progress | “Placing your order…” Clearly distinguish progress from acceptance. |
| Outcome uncertain | “We couldn't confirm the result. Check this order before placing another.” Recover the original attempt; never label it rejected without evidence. |
| Confirmed rejection | Explain the actual correction or next opening, keep the cart and allow a deliberate corrected submission. |

## Confirmation and tracking - Helen

Confirmation prominently communicates “Order received,” order number, accepted items/total, payment at collection and an action to view progress. Show the current status on recovery and omit payment instructions for Cancelled or Collected orders. “Copy tracking link” provides “Link copied” feedback; on failure expose a selectable link and manual copy guidance. Include “Save this link or bookmark the tracking page so you can check your order later. Anyone with this link can view this order.” Explain that changes/cancellation are handled by restaurant staff, not through customer controls.

Keep the accepted confirmation and private link reachable after reloading or returning to the same tab. Return via the saved link and fetch current progress; do not place the order again. During that fetch show loading or explicitly last known information. A failed fetch keeps the link available and warns that cached status may be out of date. If local saving fails, say “Save this tracking link before leaving this page” and keep copy/manual-copy actions available.

Tracking is readable directly from the saved link. It shows the current state in words, order number and accepted contents/total, plus the last successful check. It does not require an app download, account, notification permission or manual refreshing to receive normal updates.

| State | Message meaning |
|---|---|
| Received | “The restaurant has received your order. It is not ready for pickup yet.” |
| Preparing | “Your meal is being prepared. It is not ready for pickup yet.” |
| Ready | “Your order is ready for pickup.” Show exact pickup instructions and order number. |
| Collected | “This order has been collected.” Retain summary; do not invite another collection. |
| Cancelled | “This order was cancelled.” Show the staff's reason and labeled demo contact. |
| Updates unavailable | “Updates are unavailable. This status may be out of date. Last checked [time].” Keep the last status visible with the warning, including Ready. |
| Invalid/private link unavailable | “We couldn't open this tracking link. Check the full saved link.” No order details, order-number search or invented recovery process. |

Initial loading has a visible progress state; if no successful information was received, do not display a fabricated initial status or a “last checked” time. Failed updates after a successful load preserve the last successful time. Recovered updates clear the warning only once current information is obtained.

## Queue and detail - Luis

Sign-in is separate from guest ordering. Authenticated staff see Active orders by default. Show number, submission time, status and enough summary to choose an order; detail shows all accepted quantities/prices/subtotals/total, status history and permitted next actions. Show time in the restaurant's zone and dates when needed to distinguish days.

Filters are Active, Received, Preparing, Ready, Collected, Cancelled, All. New matching orders and changes appear automatically. Preserve the filter when opening and returning from detail. No results: “No orders match this filter.” Default empty Active queue: “No active orders.” Initial loading and failed loading are distinct from an empty queue.

Only offer the permitted lifecycle actions, with explicit labels “Mark Preparing,” “Mark Ready,” “Mark Collected,” and “Cancel order.” Cancellation gathers a reason and final confirmation: “Cancel order [number]? The customer will see this reason.” Do not display success until acceptance is known. A conflict says the order changed, shows its current state and asks the employee to review before choosing another valid action. No silent retry.

A stale/uncertain view warns that information may be out of date. If an attempted write's result is unknown, refresh actual state/history before offering another deliberate change. Preserve entered cancellation text through refresh failures and reauthentication in the same tab while browser storage remains available. Restore the draft only for the same order, fetch its current state after sign-in, and require a fresh deliberate action. Do not retain or expose protected order details while access is lost. Session expiry asks staff to sign in; a failed sign-in says “We couldn't sign you in. Check your credentials and try again.” Distinguish a connection or service failure from rejected credentials. Denied users see no operational order data.

## Accessibility and communication

Support phone ordering/tracking and tablet/desktop staff use. Provide readable text, visible focus, labeled controls, keyboard access, sufficiently distinct contrast and comfortably usable targets. Status meaning must not depend on color alone. Errors identify the affected field/action and explain recovery. Do not let automatic updates erase active input or unexpectedly move keyboard focus. Support browser text scaling and reflow, screen-reader labels and status/error announcements, and predictable focus when entering and dismissing cancellation confirmation. Honor reduced motion for any optional animation and transparency preferences if translucent effects are used. No animation, illustration, image, font or layout style is mandated.
