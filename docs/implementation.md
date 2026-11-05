# Mesa Tica implementation

Implementation started at `3fda43eba3961e2521782e711f154ec90a250a12` on `implementation/openai`. The exact build brief is [KICKOFF.md](../KICKOFF.md) at that commit.

## Run locally

Use Node.js 24 and npm. The runtime has no installed package dependencies.

```sh
npm run setup
npm start
```

Open http://127.0.0.1:3000. Setup generates Luis and Elena's passwords in the ignored `data/staff-credentials.json`, readable by its owner. It creates the SQLite database at `data/mesa.sqlite` with no initial orders. Repeating setup preserves existing rows, including employees and configuration. Use `MESA_DATA_DIR` to keep a separate dataset and `PORT` to choose another port.

## Milestones

1. Runnable menu foundation, persisted sample configuration, repeatable provisioning and restaurant-local opening policy.

2. Customer cart, reviewed checkout, durable same-attempt recovery, confirmation and private tracking.

The cart and its pending selection share one local storage record. The browser's Web Locks API serializes edits and checkout initiation across tabs. An attempt carries a browser-scoped random credential, a separate attempt ID and the frozen reviewed selection. SQLite serializes lookup, rejection and acceptance under `BEGIN IMMEDIATE`. Existing acceptance is returned first, including after hours, and an existing rejection is definitive. The database stores accepted order lines independently of the menu.

Private tracking uses a 256-bit random URL token, a customer-only projection and a two-second polling interval after each completed request. Links work without a login. The origin that serves the link must be reachable from the device opening it.
