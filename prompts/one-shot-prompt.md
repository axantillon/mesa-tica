# One-shot prompt

Paste the text between the lines, unchanged, into both models (Claude and GPT) in every round. Start each run in a fresh session on a new branch made from `main` at the merged diagram commit.

It points to `prompts/one-shot-brief.md`, which goes with it unchanged in every round and for both models.

---

Build the Mesa Tica web app in this repository.

The design is the twelve Mermaid diagrams in `diagrams/`. Start with `diagrams/README.md`. The requirements are the three Project 1 one-pagers in `context/one-pagers/`.

- Implement all nine user stories (A1–A3, B1–B3, C1–C3) as their sequence diagrams show. Use the classes and methods in `diagrams/03-class.mmd` and the runtime elements in `diagrams/02-architecture.mmd`.
- When the diagrams leave a detail open, make the simplest choice that meets the one-pagers, and write it down in `docs/decisions.md`.
- Do not change anything in `diagrams/` or `context/`.
- Work without asking questions. Run the app and check each story before you finish.
- Commit your work as you go on the current branch, with clear messages.
- Finish with: how to set up and run it locally and on Railway, how to sign in as staff, which stories work, and what is still missing.

Before you start, read `prompts/one-shot-brief.md` and follow it. It sets the environment, seed data, checks and final report.

---
