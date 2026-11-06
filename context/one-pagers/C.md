# One-pager C: Check order progress and collection readiness

*Transcribed verbatim from Project 1, Volume 1, Restaurant / GPT-6 Astra Light, pp. 10–11 (p. 11 is headed "Quality requirements and sizing"). Only the PDF's line breaks and page furniture were removed.*

## PROBLEM

Helen has ordered dinner before leaving the community center but does not know whether it is ready. Previously, she would call the restaurant or arrive early and wait at the counter. At confirmation, she used Copy link and pasted the private link into a phone note. She opens that saved tracking link and recognizes her order by its number and item summary. The page shows Preparing and explains that the kitchen is working on her meal. She leaves the page open while gathering her belongings; when it changes to Ready, she sees instructions for collection. If her connection drops, the page tells her that updates are unavailable, preventing her from mistaking an old status for current information.

## ASSUMPTIONS

- Customers retain their private tracking links. Recovering a lost link without an account is outside this release.
- Status information comes from employee updates and does not predict preparation time.

### Business rules

- Provide browser tracking without app installation or notification permission.
- Possession of a valid private link grants access only to its associated order; provide the save workflow defined in A3.

### FUNCTIONAL REQUIREMENTS

- **C1:** As Helen, I want to open my order summary from its tracking link so that I can confirm I am checking the correct order.
- Open the saved link directly in the browser and display the order number and purchased items.
- Limit access to the order associated with the link.
- **C2:** As Helen, I want to see my order’s current status automatically so that I can follow its progress without calling the restaurant.
- Update the displayed status while the page remains open.
- Show the last successful check time and a warning when updates fail. Resume checks after reconnection, fetch the current status, and clear the warning only after a successful check.
- **C3:** As Helen, I want to see what to do when my order is ready or cancelled so that I can decide whether to collect it or make other arrangements.
- For Ready orders, show collection instructions and the order number.
- For Cancelled orders, show the staff-provided reason and restaurant contact information.

## Quality requirements and sizing

### NON-FUNCTIONAL REQUIREMENTS

1. **Freshness:** With 100 active tracking sessions on functioning connections, 95% of saved staff status changes shall appear on customer pages within 5 seconds. In reconnection tests, show the current status and clear the warning within 5 seconds after connectivity is restored.
2. **Usability:** At least 9 of 10 test users with basic smartphone skills shall identify the current status and whether collection is appropriate within 15 seconds, without assistance.
3. **Privacy:** Tracking links shall contain randomly generated tokens with at least 128 bits of entropy; all missing or invalid token requests shall return no order data in access-control tests.

### REQUIREMENTS SIZING

Use the shared relative estimation protocol in High-level stories and sizing.

| Story | Points | Reason |
|---|---|---|
| C1 | 2 | Baseline: retrieve and display one existing order through a validated tracking link. |
| C2 | 5 | Requires automatic updates, connection-failure detection, and recovery. |
| C3 | 3 | Adds status-dependent instructions and cancellation information. |
| **Total** | **10** | |
