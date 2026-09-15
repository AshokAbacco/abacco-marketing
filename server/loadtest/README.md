# Load & Performance Testing — Abacco Marketing

This kit pushes the app to its limits **on your own machine**. It uses a local, deliberately small database and a fake mail server (Mailpit), so:

- no real emails are sent, and your Gmail accounts are never at risk;
- production data is never touched (the scripts refuse to run against a non-local database);
- every email the app "sends" is caught by Mailpit, so the test can prove there were **no duplicates and no lost emails**.

It measures three things:

| Test | What it tells you |
|---|---|
| **Send throughput** | emails/minute the worker can push, and whether the DB stays healthy while it does |
| **API load** | how many users polling the screens at once the API handles before slowing down or failing |
| **Crash recovery** | what happens when the database or worker dies mid-campaign |

## 0. Requirements (one time)

- **Docker Desktop** (for Postgres + Mailpit)
- **Node.js 20.6 or newer** (`node -v`); the scripts use `--env-file`
- Install the HTTP load tool, in `server/`:

```powershell
npm i -D autocannon
```

All commands below are run from the **`server/`** folder in PowerShell.

## 1. Start the test environment

```powershell
docker compose -f loadtest/docker-compose.yml up -d
```

- **Postgres** runs on port **5433**. It is limited to 1 GB RAM and 40 connections to mimic a small plan.
- **Mailpit** listens for SMTP on port **1025**, with a web inbox at **http://localhost:8025**.

Create the tables in the test database:

```powershell
$env:DATABASE_URL="postgresql://loadtest:loadtest@localhost:5433/abacco_loadtest"
npx prisma db push
docker exec lt-postgres psql -U loadtest -d abacco_loadtest -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
Remove-Item Env:DATABASE_URL
```

> `Remove-Item` matters. It makes sure later commands in this window can't accidentally inherit the test URL, or the other way around.

## 2. Seed test data

```powershell
node --env-file=loadtest/.env.loadtest loadtest/seed.mjs --accounts=20 --users=25
```

This creates:

- **1 admin user** who owns 20 sender mailboxes. They all point at Mailpit and are excluded from IMAP sync.
- **25 extra users** for the API test.
- **`loadtest/.state.json`** with login tokens (valid 7 days).

## 3. Start the app with the test settings

Open **three PowerShell windows** in `server/`:

```powershell
# Window 1 — API
node --env-file=loadtest/.env.loadtest server.js

# Window 2 — worker
node --env-file=loadtest/.env.loadtest worker.js

# Window 3 — live monitor
node --env-file=loadtest/.env.loadtest loadtest/monitor.mjs
```

Close any normal `npm run dev` instances first. They load `.env` (your real database) and would compete for port 5000. The test API runs on **5050**.

## 4. Test A: sending throughput

In a fourth window:

```powershell
node --env-file=loadtest/.env.loadtest loadtest/create-campaigns.mjs --campaigns=4 --recipients=2500 --rate=36000
```

That is 10,000 emails across 4 campaigns, with 5 accounts each.

Watch the monitor window. Every 5 seconds it shows something like this (illustrative numbers; yours will differ):

```
📤 sent 3,412  | 1,180/min  | pending 6,588  processing 4  failed 0
🔌 connections 11/40  → abacco-worker:6(2 active)  abacco-api:4(0 active) ...
🗄️  310 tx/s  | deadlocks 0  | temp files 0  | size 48.2 MB
```

When all campaigns show `completed`, press **Ctrl+C** in the monitor for the summary:

```
Emails sent (DB)    10,000
Average throughput  1,150 /min   (peak 1,240 /min)
Peak DB connections 12
Mailpit received    10,000  → ✅ exact match — no duplicates, no losses
Duplicate recipient rows: ✅ none
Top queries by total time: ...
```

### Pass criteria

- Mailpit count equals DB sent count (**the most important check**).
- Connections stay below 80% of the maximum, with no `STUCK` warnings and 0 deadlocks.
- All campaigns reach `completed`.

### Finding the ceiling

Change **one thing at a time**, then reset (step 7) and repeat Test A.

| Run | Change | Expect |
|---|---|---|
| 1 | defaults (`ACCOUNT_CONCURRENCY=4`) | baseline emails/min |
| 2 | `ACCOUNT_CONCURRENCY=8` in `.env.loadtest`, restart the worker | higher throughput, more worker connections |
| 3 | `ACCOUNT_CONCURRENCY=12` and `PRISMA_POOL_SIZE=14` | throughput stops rising → that's the ceiling |
| 4 | reseed with `--accounts=60`, create `--campaigns=6 --recipients=5000` | behaviour with many active mailboxes |

Two built-in speed limits cap the results:

- **200 ms minimum per email, per account.** This is at most 5 emails/second per mailbox (18,000/hour).
- **`ACCOUNT_CONCURRENCY`.** This is how many sends happen at the same moment across all accounts.

In production, **Gmail's own limits (about 50/hour per account) are the real bottleneck**. This test proves the *system* has plenty of headroom above that.

## 5. Test B: API under many users

With the API running (and ideally a campaign sending, for realism):

```powershell
node --env-file=loadtest/.env.loadtest loadtest/api-load.mjs --stages=10,50,100,200 --duration=30
```

It simulates users polling the campaign screens (daily limit, locked accounts, accounts, progress) and opening heavy pages (campaign list, dashboard, follow-ups, admin overview, campaign detail, recipient list). It ramps up the number of concurrent connections. Example output (illustrative):

```
conns    req/s   p50 ms   p90 ms   p99 ms   max ms    requests    4xx    5xx  net-err
   10    1,850        4        9       21       80      55,500      0      0        0
   50    2,300       19       35       70      190      69,000      0      0        0
  100    2,350       40       70      160      420      70,500      0      0        0
  200    2,300       85      140      380      900      69,000      0      0        0
```

Options:

- `--mix=poll` runs only the polling endpoints; `--mix=heavy` runs only the big pages.
- `--duration=60` gives longer, more stable stages.

### How to read the results

- **One "connection" ≈ 5–10 real users.** Real users poll every 10–30 s, not continuously.
- **Healthy:** p99 under about 1 second and **0 5xx** at your expected load.
- **503s:** the database pool was exhausted and the API shed load to protect itself. That stage is your limit.
- **Ceiling reached:** req/s stops growing while p99 keeps climbing.
- **Keep the worker running during this test.** The monitor window then shows whether heavy API traffic slows sending down.

## 6. Test C: crash recovery (chaos)

Start a campaign (Test A), wait until a few hundred are sent, then:

**C1: database restart**

```powershell
docker restart lt-postgres
```

**Expect:**

- The worker logs `Database unreachable … Pausing` and later `Database recovered`.
- The API returns 503 (users are **not** logged out).
- Sending resumes on its own, and the final summary still shows **✅ exact match**.

**C2: worker crash**

Press Ctrl+C in the worker window (or close it), wait 10 s, then start it again.

**Expect:**

- The worker picks the campaign up again.
- Rows that were mid-send are recovered within about 3 minutes.
- Mailpit total minus DB sent is **0**. In the worst case it is off by a number no larger than `ACCOUNT_CONCURRENCY` (emails the SMTP server accepted in the instant before the kill).

**C3: stop and resume from the UI or API**

Stop a sending campaign in the app, check the monitor (sending halts within about 3 s), then resume it.

**Expect:** it continues where it left off, with no duplicates in the summary.

## 7. Reset between runs

```powershell
node --env-file=loadtest/.env.loadtest loadtest/reset.mjs
```

This removes test campaigns, empties Mailpit, and resets query statistics. It keeps the users and accounts.

Add `--all` to remove the users and accounts as well. To delete **everything**, including the containers and data:

```powershell
docker compose -f loadtest/docker-compose.yml down -v
```

## 8. Frontend performance (Lighthouse)

```powershell
cd ..\client
npm run build
npm run preview
```

Open the printed URL in Chrome, then:

1. Open **DevTools → Lighthouse**.
2. Choose **Desktop**, then **Analyze page load**.
3. Test **/login** (no login needed).
4. Log in, then test **/campaigns** and **/inbox**.

Always test the **production build** (`preview`), never `npm run dev`. Dev mode is unoptimised and scores much lower.

## Record your results

| Date | Run | Accounts | ACCOUNT_CONCURRENCY | Emails/min | Peak conns | Mailpit match | API: max conns with 0 5xx | p99 at that level |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Keep the best stable settings (no 5xx, no STUCK, exact Mailpit match) and use slightly lower values in production. The production database has other work to do too (IMAP sync, real users).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL points at "…", which is not a local database` | You ran a script without `--env-file=loadtest/.env.loadtest`. |
| `Cannot reach the database` | `docker compose -f loadtest/docker-compose.yml up -d`, then wait about 10 s. |
| `API not ready at http://localhost:5050` | Start window 1, and check that nothing else uses port 5050. |
| Campaign creation says accounts are busy | Earlier campaigns are still sending: wait, reset, or seed more accounts. |
| Mailpit shows MORE than sent | Mailpit wasn't emptied from a previous run; run `reset.mjs` first. |
| `Unknown option --env-file` | Upgrade Node.js to 20.6+. |
| Every email fails with an auth/connection error | Mailpit isn't running (`docker ps` should list `lt-mailpit`). |
