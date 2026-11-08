# Mesa Tica

CS 3365 Project 2 (high-level design and MVP). Team: Ian Hu Pacheco and Andres Antillon. Product: Restaurant / GPT-6 from Project 1, renamed Mesa Tica.

Mesa Tica is a pickup-ordering web app for one restaurant. Customers order as guests and follow their order through a private link. Staff run a shared order queue.

`main` holds the design. The app is generated from it, in one shot, by two code models (Claude and GPT). This branch (`round1-claude`) holds Claude's generated app: Node 24, no npm dependencies, one SQLite file.

## Folder map

| Path | What it is |
|---|---|
| `diagrams/` | The 12 Mermaid diagrams: context, architecture, class, and one sequence per user story. `diagrams/README.md` says what each shows and why it is valuable. |
| `context/one-pagers/` | One-pagers A, B and C from Project 1, word for word. They hold the nine user stories. |
| `prompts/one-shot-prompt.md` | The prompt that starts each generation. The same for both models. |
| `prompts/one-shot-brief.md` | The brief the prompt points to: environment, seed data, checks per story, final report. |
| `server.js` | The `node:http` server: the three pages, their scripts, and the JSON API (one route per controller method). |
| `setup.js` | `npm run setup`: creates the tables and adds the restaurant, menu and staff accounts if missing. |
| `a-ordering/` | Module A: `OrderingController`, `MenuPage` (`/`), `Cart`. |
| `b-staff/` | Module B: `StaffController`, `StaffPage` (`/staff`). |
| `c-tracking/` | Module C: `TrackingController`, `TrackingPage` (`/track/{token}`). |
| `shared/` | `RestaurantStore`, `OrderStore` and `StaffStore` (`stores.js`), the polling state (`Poller.js`), page helpers and the stylesheet. |
| `test/` | One `node:test` test per story, plus restart, setup and load checks. |
| `docs/` | `decisions.md` (choices the design left open) and `story-status.md` (what works, and the evidence). |

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

## Run it locally

You need Node 24 (`node --version` shows `v24.x`). There is nothing to install.

```bash
npm run setup
```

```bash
npm start
```

Then open http://localhost:3000/ (menu and cart), http://localhost:3000/staff (staff queue), and the tracking link you get after placing an order.

- Data goes to `./data/mesa.sqlite`. Set `DATA_DIR` to put it elsewhere. Orders survive restarts.
- The server listens on `0.0.0.0:$PORT` (default `3000`).
- Opening hours are 10:00 to 21:00 Costa Rica time, every day, decided by the server clock. Outside those hours you can browse but not order. To try ordering at any hour, start the clock at an open time:

```bash
TEST_NOW=2026-11-06T18:00:00Z npm start
```

`TEST_NOW` starts the server clock at that instant (here, 12:00 in Costa Rica) and lets it run from there. Never set it on Railway.

Node prints an `ExperimentalWarning` for `node:sqlite`. It is harmless.

## Staff sign-in

There are two staff accounts with the same permissions: username `luis` (Luis) and `elena` (Elena). Sign in at `/staff`.

Passwords come from `npm run setup`:

- If `STAFF_PASSWORD_LUIS` or `STAFF_PASSWORD_ELENA` is set, that value becomes the password.
- If not, setup generates a password, prints it once, and appends it to `$DATA_DIR/staff-credentials.txt` (for example `./data/staff-credentials.txt`).

Setup only adds an account that is missing. Changing a variable later does not change an existing password. To start over locally, delete the `data/` folder and run setup again (this also deletes the orders).

```bash
STAFF_PASSWORD_LUIS='choose-one' STAFF_PASSWORD_ELENA='choose-another' npm run setup
```

A session lasts 12 hours. There is no sign-out button, because the design has no sign-out route.

## Tests

```bash
npm test
```

This runs `node --test`: 57 tests, offline, each server on its own temporary `DATA_DIR`, with an injected clock. Test names start with their story (`A3 place order`, `B3 update status`, and so on). They include 100 mixed submissions, 100 same-version status pairs, and a restart.

## Deploy to Railway

1. Push this branch to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, and pick the repository. In the service's **Settings → Source**, set the branch to `round1-claude`.
3. Add a volume: right-click the service (or press ⌘K) → **Attach volume**, mount path `/data`.
4. In **Variables**, add:
   - `DATA_DIR` = `/data`
   - `STAFF_PASSWORD_LUIS` = a strong password
   - `STAFF_PASSWORD_ELENA` = another strong password

   Do not set `PORT` (Railway sets it) or `TEST_NOW`.
5. The start command comes from `railway.json`: `npm run setup && npm start`, with health check `/api/menu`. Node 24 comes from `"engines"` in `package.json`. There is no build step.
6. **Settings → Networking → Generate Domain.** Open `https://<your-domain>/` and `https://<your-domain>/staff`.
7. Keep the service at one replica. The SQLite file on the volume has a single writer.

Each deploy runs setup again. Setup creates nothing new once the data exists, and never overwrites. Railway runs in UTC. The app always uses `America/Costa_Rica` for opening hours. Railway puts HTTPS in front, so the staff cookie gets `Secure`, and Copy link can use the clipboard.

## What works and what is missing

All nine stories work. See `docs/story-status.md` for the evidence for each.

Not built, or not measured:

- Not measured: menu and queue load times under load, freshness percentiles, and the usability targets.
- No sign-out, no password change or reset, and no clean-up of expired sessions.
- No rate limit on staff sign-in.
- Outside the design (Project 1 scope): online payment, holiday hours, scheduled orders, screens to edit the menu, hours or staff, customer accounts, recovering a lost link, push notifications.
