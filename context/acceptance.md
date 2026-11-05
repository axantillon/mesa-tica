# Product acceptance checklist

These checks describe observable outcomes, not test tooling or implementation mechanisms. No checks have been run against an application. Use the provided fictional menu; do not report automated checks as real-user validation.

| ID | Capability | Observable result |
|---|---|---|
| SETUP | Initial setup | Documented setup yields a usable app with the supplied menu/hours, no preset customer orders and at least two distinguishable authorized staff accounts. Orders and accepted history survive restart. Setup does not unexpectedly erase existing data. |
| A1 | A1 | Available and unavailable dishes show correct name/description/price. Fish casado cannot be ordered while unavailable. Closed browsing works, new submissions are unavailable and next opening is clear. Opening is inclusive, closing exclusive in restaurant-local time. |
| A2 | A2 | Adding the same dish increases its quantity. Changes/removal recalculate exact totals. Reject zero, negative, fractional and nonnumeric quantities with correction. An empty cart cannot be submitted. The worked menu totals match. |
| A3 | A3 | Valid guest order needs no personal information or account and yields one Received order with accepted contents/total, number and private link. Empty/invalid/closed orders are rejected without creating an order. |
| A3-REVIEW | A3 | Repriced or unavailable items require correction/review and explicit resubmission, with no silent substitution or changed total acceptance. Cart is retained. |
| A4 | A4 | Repeated or simultaneous attempts for one submission, including a lost confirmation and accepted retry after closing, return the same accepted result and create one order. A deliberate new order is separate. A definitive rejection cannot turn into acceptance on retry. Uncertain outcome is labeled honestly; recovery does not expose another customer's order. |
| A5 | A5 | Confirmation has copy success feedback, manual-copy fallback, save guidance and clear payment-at-collection instructions. Omit payment instructions for recovered cancelled or collected orders. Known acceptance clears the purchased selection. |
| B1 | B1 | Staff sign in/out, default to oldest-first Active queue and can use all specified filters. New matching orders and changes appear automatically. Returning from detail preserves filter; empty and failed states differ. |
| B1-STALE | B1 | Update failure preserves last information/check time and marks it stale. Recovery clears warning only after receiving current information. Lost access requires sign-in. |
| B2 | B2 | Staff detail shows accepted names/prices/quantities/time/total, current status and status history even after menu changes. |
| B3 | B3 | Only listed transitions succeed. Cancel requires customer-visible nonblank reason and explicit confirmation; dismissing confirmation changes nothing. Collected/Cancelled cannot change. Accepted changes identify employee/time. |
| B3-CONFLICT | B3 | Two individually valid competing staff changes against the same observed state yield one success and one explained conflict. Current state is shown; another attempt is deliberate and valid. A rejected change does not overwrite another employee's work. Refresh during confirmation does not change the revision the employee chose. |
| C1 | C1 | Saved private link opens only its associated order without login. Invalid/missing links and a guessed order number disclose no order data. A timeout is not presented as an invalid link. Public view exposes no staff identities. Private links contain at least 128 bits of random entropy. |
| C2 | C2 | Open tracking updates automatically. Failure preserves status/time with warning; successful recovery obtains current status before clearing warning. No invented status/check time during initial failure. |
| C3 | C3 | Received/Preparing say not ready; Ready shows pickup and payment instructions; Cancelled shows reason/labeled demo contact; Collected does not invite pickup again. Stale warnings remain clear for every status. |
| ACCESS | B1-B3 | Unauthorized people cannot view staff data or change an order by bypassing the visible controls. Customer tracking grants no staff/change permissions. |
| EXPERIENCE | Usability | Core journeys work on phone and tablet/desktop as appropriate. Text/labels/focus, keyboard use and status meaning are clear. Errors retain useful input and explain recovery; automatic updates do not erase active input. |
| RUN | Complete-product outcome | A reviewer can follow actual run instructions, place an order, manage it as staff and see customer progress with durable state. Deployment instructions name actual prerequisites; a local run is not claimed as a live deployment. |

## Quality targets

- Menu: with 100 concurrent customer sessions on >=10 Mbps connections, 95% of loads finish within 2 seconds.
- Queue: 10 staff sessions, 200 active orders and >=10 Mbps connections; 95% of loads finish within 2 seconds and 95% of matching new orders/status changes appear within 5 seconds of acceptance.
- Tracking: 100 active sessions on functioning connections; 95% of saved staff status changes appear within 5 seconds. Recovery obtains current status and clears the warning within 5 seconds after connectivity returns.
- Submission reliability: 100 cases covering valid, repeated, lost-response and rejected attempts preserve exactly one order per accepted submission and none per rejected submission.
- Staff consistency: 100 pairs of individually valid conflicting same-state updates yield exactly one success and one explained conflict, with deliberate valid recovery.
- Human usability: 9/10 first-time users complete a three-item order unaided within 3 minutes; 9/10 users with basic smartphone skills identify status and whether collection is appropriate unaided within 15 seconds.

The application should demonstrate the functional journey and check meaningful failure paths. Report which quality targets were measured, with conditions/results, and which remain unverified. Human studies require actual participants; concurrency/load targets require actual measurements. No additional uptime SLA, certification, medical/dietary claim, large-scale benchmark or production-readiness guarantee is introduced.
