# Mesa Tica

CS 3365 Project 2 (high-level design and MVP). Team: Ian Hu Pacheco and Andres Antillon. Product: Restaurant / GPT-6 from Project 1, renamed Mesa Tica.

Mesa Tica is a pickup-ordering web app for one restaurant. Customers order as guests and follow their order through a private link. Staff run a shared order queue.

This repository holds the design, not the code. The app is generated from these files, in one shot, by two code models (Claude and GPT).

## Folder map

| Path | What it is |
|---|---|
| `diagrams/` | The 12 Mermaid diagrams: context, architecture, class, and one sequence per user story. `diagrams/README.md` says what each shows and why it is valuable. |
| `context/one-pagers/` | One-pagers A, B and C from Project 1, word for word. They hold the nine user stories. |
| `prompts/one-shot-prompt.md` | The prompt that starts each generation. The same for both models. |
| `prompts/one-shot-brief.md` | The brief the prompt points to: environment, seed data, checks per story, final report. |

## How the rounds work

1. `main` holds only the design. Generated code never goes into `main`.
2. Each generation runs on its own branch made from `main`: `round1-claude`, `round1-gpt`, and so on.
3. Between rounds, only `diagrams/` changes, through a pull request. Nothing in `context/` or `prompts/` changes.
4. After each merged pull request, both models run a full generation again.
5. At most 3 rounds.

## Design choices

- **Staff sign-in (B1).** Project 1 treats staff accounts as supplied (p. 8) and leaves an identity service out (p. 13). The design adds only what the app needs to run: setup creates two staff accounts, and sign-in checks a password and starts a session. No sign-up, no account screen.
- **Retries after closing (A1 and A3).** When the restaurant is closed, Place order is disabled for new orders. A submission still waiting for its answer can be resent, so a response lost just before closing still returns its confirmation.
- **Data store.** One SQLite file through Node's built-in `node:sqlite`, on a Railway volume. No npm dependencies.
- **Freshness.** The staff queue and the tracking page ask the server every 2 seconds. Project 1 asks for changes to show within 5 seconds.
