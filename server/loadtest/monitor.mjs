// loadtest/monitor.mjs
//
// Live dashboard while a load test runs. Every few seconds it prints:
//   • send throughput (emails/min) and queue state
//   • database connections per process, active queries, slowest query
//   • Postgres commit rate, deadlocks, temp-file spills, DB size
// On Ctrl+C it prints a summary and the DUPLICATE / LOSS check against
// Mailpit (every "sent" row must match exactly one received email).
//
//   node --env-file=loadtest/.env.loadtest loadtest/monitor.mjs --interval=5

import { assertSafeDatabase, arg, loadState, getPrisma, sleep, fmt } from "./lib.mjs";

assertSafeDatabase();

const INTERVAL = arg("interval", 5) * 1000;
const MAILPIT = process.env.LT_MAILPIT_API || "http://localhost:8025";
const prisma = await getPrisma(2);

const samples = [];
let prevSent = null;
let prevXact = null;
let prevT = null;
let peakConns = 0;
let peakRate = 0;
let stopping = false;
const startedAt = Date.now();

async function campaignIds() {
  // Re-read each tick so campaigns created after the monitor started count.
  try { return loadState().campaignIds; } catch { return []; }
}

async function mailpitTotal() {
  try {
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=1`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.messages_count ?? j.total ?? null;
  } catch {
    return null;
  }
}

async function snapshot() {
  const ids = await campaignIds();
  const now = Date.now();

  const [queue, conns, activity, dbstat, stuck, campaigns] = await Promise.all([
    ids.length
      ? prisma.$queryRaw`
          SELECT "status", count(*)::int AS n
          FROM "CampaignRecipient"
          WHERE "campaignId" = ANY(${ids}::int[])
          GROUP BY "status"`
      : [],
    prisma.$queryRaw`
      SELECT coalesce(nullif(application_name, ''), 'other') AS app,
             count(*)::int AS total,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_tx
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT round(extract(epoch FROM (now() - query_start)) * 1000)::int AS ms,
             left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS query
      FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
      ORDER BY query_start ASC LIMIT 1`,
    prisma.$queryRaw`
      SELECT (xact_commit + xact_rollback)::bigint AS xact, deadlocks::int AS deadlocks,
             temp_files::int AS temp_files, pg_database_size(datname)::bigint AS size,
             (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
      FROM pg_stat_database WHERE datname = current_database()`,
    ids.length
      ? prisma.$queryRaw`
          SELECT count(*)::int AS n FROM "CampaignRecipient"
          WHERE "campaignId" = ANY(${ids}::int[])
            AND "status" = 'processing'
            AND "updatedAt" < now() - interval '3 minutes'`
      : [{ n: 0 }],
    ids.length
      ? prisma.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
      : [],
  ]);

  const q = Object.fromEntries(queue.map(r => [r.status, r.n]));
  const sent = q.sent || 0;
  const totalConns = conns.reduce((s, c) => s + c.total, 0);
  const db = dbstat[0];
  const xact = Number(db.xact);

  let rate = 0, tps = 0;
  if (prevT) {
    const dt = (now - prevT) / 1000;
    rate = ((sent - prevSent) / dt) * 60;
    tps = (xact - prevXact) / dt;
  }
  prevSent = sent; prevXact = xact; prevT = now;
  peakConns = Math.max(peakConns, totalConns);
  peakRate = Math.max(peakRate, rate);
  samples.push({ t: now, sent, rate, totalConns, tps });

  const statusCount = campaigns.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {});
  const elapsed = Math.round((now - startedAt) / 1000);

  console.log(
    `\n[${new Date().toLocaleTimeString()}] +${elapsed}s  campaigns ${JSON.stringify(statusCount)}`
  );
  console.log(
    `  📤 sent ${fmt(sent)}  | ${fmt(rate)}/min  | pending ${fmt(q.pending || 0)}  processing ${fmt(q.processing || 0)}  failed ${fmt(q.failed || 0)}` +
    (stuck[0].n ? `  ⚠️ STUCK ${stuck[0].n}` : "")
  );
  console.log(
    `  🔌 connections ${totalConns}/${db.max_conn}` +
    (totalConns > db.max_conn * 0.8 ? "  ⚠️ NEAR LIMIT" : "") +
    `  → ` + conns.map(c => `${c.app}:${c.total}(${c.active} active${c.idle_tx ? `, ${c.idle_tx} idle-in-tx` : ""})`).join("  ")
  );
  console.log(
    `  🗄️  ${fmt(tps)} tx/s  | deadlocks ${db.deadlocks}  | temp files ${db.temp_files}  | size ${fmt(Number(db.size) / 1048576, 1)} MB`
  );
  if (activity[0] && activity[0].ms > 500) {
    console.log(`  🐢 longest running: ${activity[0].ms} ms — ${activity[0].query}`);
  }
}

async function summary() {
  const ids = await campaignIds();
  const [{ sent = 0 } = {}] = ids.length
    ? await prisma.$queryRaw`
        SELECT count(*)::int AS sent FROM "CampaignRecipient"
        WHERE "campaignId" = ANY(${ids}::int[]) AND "status" = 'sent'`
    : [{ sent: 0 }];
  const dupRows = ids.length
    ? await prisma.$queryRaw`
        SELECT count(*)::int AS n FROM (
          SELECT "campaignId", "email" FROM "CampaignRecipient"
          WHERE "campaignId" = ANY(${ids}::int[])
          GROUP BY 1, 2 HAVING count(*) > 1
        ) d`
    : [{ n: 0 }];
  const inbox = await mailpitTotal();

  const rates = samples.map(s => s.rate).filter(r => r > 0);
  const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  let top = [];
  try {
    top = await prisma.$queryRaw`
      SELECT calls::int, round(mean_exec_time::numeric, 1)::float AS mean_ms,
             round(total_exec_time::numeric)::float AS total_ms,
             left(regexp_replace(query, '\\s+', ' ', 'g'), 100) AS query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC LIMIT 8`;
  } catch { /* extension not available */ }

  console.log("\n══════════════════════════ LOAD TEST SUMMARY ══════════════════════════");
  console.log(`Duration            ${Math.round((Date.now() - startedAt) / 1000)} s`);
  console.log(`Emails sent (DB)    ${fmt(sent)}`);
  console.log(`Average throughput  ${fmt(avg)} /min   (peak ${fmt(peakRate)} /min)`);
  console.log(`Peak DB connections ${peakConns}`);
  if (inbox === null) {
    console.log("Mailpit check       skipped (Mailpit API not reachable)");
  } else {
    const diff = inbox - sent;
    const verdict =
      diff === 0 ? "✅ exact match — no duplicates, no losses"
      : diff > 0 ? `❌ ${diff} MORE emails received than recorded (duplicates or leftovers from an earlier run — clear Mailpit before each run)`
      : `⚠️ ${-diff} recorded as sent but not received (should be 0)`;
    console.log(`Mailpit received    ${fmt(inbox)}  → ${verdict}`);
  }
  console.log(`Duplicate recipient rows: ${dupRows[0].n === 0 ? "✅ none" : `❌ ${dupRows[0].n}`}`);
  if (top.length) {
    console.log("\nTop queries by total time:");
    for (const r of top) {
      console.log(`  ${String(r.calls).padStart(7)} calls  ${String(r.mean_ms).padStart(7)} ms avg  ${r.query}`);
    }
  }
  console.log("═══════════════════════════════════════════════════════════════════════");
}

process.on("SIGINT", async () => {
  if (stopping) process.exit(0);
  stopping = true;
  try { await summary(); } catch (e) { console.error("summary failed:", e.message); }
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});

console.log(`📊 Monitoring every ${INTERVAL / 1000}s — press Ctrl+C for the summary.`);
while (!stopping) {
  try {
    await snapshot();
  } catch (err) {
    console.log(`  🔌 DB unreachable: ${err.message.split("\n").pop()}`);
  }
  await sleep(INTERVAL);
}
