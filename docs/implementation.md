# Implementation

Starting commit: `a196dd9` (the exact independent-build prompt is in `KICKOFF.md`). Node.js 24 and its built-in SQLite provide a local single-process runtime with no external dependencies. Run `npm run setup`, then `npm start`. Setup writes newly generated staff credentials to `data/staff-credentials.txt` (or a timestamped file if it already exists); it does not reset existing accounts or data. Open http://localhost:3000 and use the staff link to sign in.

The database and credentials are local and excluded from Git. Repeated setup uses insert-if-absent semantics. No real restaurant or contact is implied. Public deployment requires an appropriately secured host, TLS, persistent backed-up SQLite storage, protected credentials and an operational review; it has not been deployed.

Milestone: local database and repeatable setup foundation.
