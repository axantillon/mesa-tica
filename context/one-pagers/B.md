# One-pager B: Manage the restaurant’s order queue

*Transcribed verbatim from Project 1, Volume 1, Restaurant / GPT-6 Astra Light, pp. 8–9. Only the PDF's line breaks and page furniture were removed.*

## PROBLEM

During the lunch rush, Luis supervises food preparation while answering questions at the counter. Handwritten tickets make it difficult to tell which orders have started and which are ready. He signs into the admin portal and sees incoming orders arranged by submission time, with new orders and status changes appearing automatically. He opens an order to check the items and quantities, then marks it Preparing when the kitchen starts work. When the meal is packed, he marks it Ready, and later Collected after handoff. If another employee changes an order first, Luis sees the current status and a conflict explanation, then deliberately retries only if his intended change is still valid. If the restaurant cannot fulfill an order, he cancels it with a reason so the customer can see what happened.

## ASSUMPTIONS

- Staff accounts and authentication infrastructure are proposed supplied dependencies; availability must be confirmed by the team.
- Employees update statuses when preparation and handoff occur.
- Multiple employees may use the portal simultaneously.

### Business rules

- Only authenticated, authorized staff can access admin data or change statuses.
- Enforce Received → Preparing → Ready → Collected, with cancellation allowed from any nonterminal status. Collected and Cancelled are terminal.
- Automatically refresh the open queue on functioning connections and recover as specified in B1. Reject stale updates and require deliberate recovery as specified in B3.

## One-pager B: Manage the restaurant’s order queue - requirements

### FUNCTIONAL REQUIREMENTS

- **B1:** As Luis, I want to view incoming and active orders so that I can organize the kitchen’s workload.
- List orders by submission time, oldest first, and allow filtering by status.
- Automatically fetch new orders and refresh existing orders while the queue is open, preserving the filter; show the last successful refresh time and a stale-data warning on failure, then refresh after reconnection.
- **B2:** As Luis, I want to inspect an order’s contents so that the kitchen prepares the correct meal.
- Show the order number, items, quantities, and submission time.
- Preserve the item names and prices recorded when the order was accepted.
- **B3:** As Luis, I want to update an order’s status so that staff and customers know its current progress.
- Enforce Received → Preparing → Ready → Collected; allow cancellation before collection with a reason, and record the employee and timestamp for every accepted change.
- Reject changes based on a stale order version; show the current state and explain the conflict, then permit a deliberate retry of a still-valid transition against the refreshed version. Never silently overwrite or automatically resubmit the rejected change.

### NON-FUNCTIONAL REQUIREMENTS

1. **Performance and freshness:** With 10 concurrent staff sessions, 200 active orders, and functioning connections of at least 10 Mbps, 95% of queue loads shall complete within 2 seconds; 95% of newly accepted orders and saved status changes shall appear in matching open queue views within 5 seconds of server commit.
2. **Security:** Every admin data request and status-change request shall reject unauthenticated users and users without staff authorization in automated access-control tests.
3. **Consistency:** In 100 tests where two employees simultaneously update the same order version, exactly one update shall succeed; the other shall receive a conflict response displaying the current state, with no automatic retry. A deliberate retry shall succeed only if valid against the latest version.

### REQUIREMENTS SIZING

Use the shared relative estimation protocol in High-level stories and sizing.

| Story | Points | Reason |
|---|---|---|
| B1 | 8 | Adds automatic discovery, refresh, and connection recovery to protected queue access and filtering. |
| B2 | 2 | Uses the baseline summary pattern to display stored order information. |
| B3 | 8 | Requires transition rules, audit records, concurrency control, and explicit conflict recovery. |
| **Total** | **18** | |
