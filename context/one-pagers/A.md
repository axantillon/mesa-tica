# One-pager A: Browse the menu and place an order

*Transcribed verbatim from Project 1, Volume 1, Restaurant / GPT-6 Astra Light, pp. 6–7. Only the PDF's line breaks and page furniture were removed.*

## PROBLEM

Maya has 30 minutes between classes and wants to collect lunch from a nearby restaurant. Calling often leaves her waiting, and the printed menu she saved may have outdated prices. She opens the restaurant’s customer portal, checks available dishes and prices, and adds her lunch to a cart. After noticing that she selected two drinks, she changes the quantity and reviews the total. She submits her pickup order and receives an order number and tracking link with a Copy link control, allowing her to continue her day knowing the restaurant has received her request.

## ASSUMPTIONS

- Payment is handled at collection; online payment is outside this release.
- Menu prices include applicable taxes; there are no additional checkout fees.
- Menu maintenance is handled separately; customers have an internet connection.
- A fixed weekly opening schedule and restaurant time zone are configured before use; holiday exceptions and scheduled orders are outside this release. Staff finish accepted orders after closing.

### Business rules

- Allow guest ordering without an account.
- Accept submissions from opening time inclusive to closing time exclusive, determined by server time and the configured restaurant time zone.
- A retry of the same logical submission must reuse its submission identifier and return its existing confirmation if already accepted, including after closing. A new intentional order uses a new identifier. Validate submissions that have not already been accepted; rejected submissions create no order.

## One-pager A: Browse the menu and place an order - requirements

### FUNCTIONAL REQUIREMENTS

- **A1:** As Maya, I want to browse available dishes and prices so that I can choose a meal within my budget.
- Show each dish’s name, description, price, and availability.
- Prevent adding unavailable dishes; when closed, show the next opening time and allow browsing but disable order submission.
- **A2:** As Maya, I want to review and edit my cart so that my order contains the items and quantities I intend to buy.
- Allow quantity changes and explicit item removal; reject zero, negative, fractional, and nonnumeric quantities with a correction message.
- Recalculate the total after every change.
- **A3:** As Maya, I want to submit my pickup order so that the restaurant can prepare my meal.
- For a submission not already accepted, the server rejects empty orders, quantities other than positive integers, and orders submitted while closed; retain the cart and explain corrections or the next opening time. Recheck prices and availability and require review if either changed.
- Return a unique order number and private tracking link with status Received. Provide Copy link with success feedback, a selectable URL if copying fails, and a short instruction to paste it into a note or bookmark the tracking page for later.

### NON-FUNCTIONAL REQUIREMENTS

1. **Performance:** With 100 concurrent customer sessions on connections of at least 10 Mbps, 95% of menu loads shall complete within 2 seconds.
2. **Usability:** At least 9 of 10 first-time test users shall complete a three-item order without assistance within 3 minutes.
3. **Reliability:** Across 100 tests covering valid submissions, repeated attempts, lost responses, and rejected submissions, each accepted logical submission shall create exactly one order; its retries shall return the same confirmation. Rejected submissions shall create no order.

### REQUIREMENTS SIZING

Use the shared relative estimation protocol in High-level stories and sizing.

| Story | Points | Reason |
|---|---|---|
| A1 | 3 | Adds menu presentation, availability handling, and open/closed messaging beyond a simple summary view. |
| A2 | 3 | Requires editable cart state, positive-integer validation, and consistent totals. |
| A3 | 8 | Combines server validation and opening-hours checks, durable creation, duplicate prevention, and a copy/save confirmation. |
| **Total** | **14** | |
