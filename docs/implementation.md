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
