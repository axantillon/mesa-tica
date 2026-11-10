# Mesa Tica implementation

Status: in progress. This record is updated at each milestone.

## Provenance

- Kickoff prompt: [KICKOFF.md](../KICKOFF.md), kept unchanged and used exactly as written.
- Round 3 starting commit: `e18f506f98a21f121ec02ab72001793073e48f1d` ("Merge corrected isolated context for Round 3"), the `main` commit containing the complete context revision.
- Implementation branch: `implementation/round3-claude`, created from that commit.
- Product and design inputs (`context/`, `design/`, `README.md`) are the sole design authority and are not modified.

## Architecture (initial)

- Runtime: Node.js 22.13+ (verified on 24.5) using only the standard library: `node:http` for the web
  backend and `node:sqlite` for durable storage. No runtime npm dependencies.
- Storage: one SQLite file (`<data dir>/mesa.sqlite`, WAL mode). Indivisible decisions use
  `BEGIN IMMEDIATE` transactions.
- Browser frontend: plain HTML/CSS and ES modules served by the backend (customer `/`, tracking
  `/track/<private token>`, staff `/staff`).

## Milestones

1. Runnable foundation: backend stores, policies, services, controllers, setup and server entry.
