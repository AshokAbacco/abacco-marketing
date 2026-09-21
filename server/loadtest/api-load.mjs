// loadtest/api-load.mjs
//
// HTTP load test for the API, simulating many logged-in users polling the
// campaign screens at the same time. Ramps through several concurrency
// levels and prints latency percentiles and error counts per level.
//
//   npm i -D autocannon
//   node --env-file=loadtest/.env.loadtest loadtest/api-load.mjs --stages=10,50,100,200 --duration=30
//
//   --stages     concurrent connections per stage   (default 10,50,100,200)
//   --duration   seconds per stage                  (default 30)
//   --mix        "poll" (dashboard polling), "heavy" (lists + detail views), or "all" (default)

import { arg, loadState, fmt } from "./lib.mjs";

let autocannon;
try {
  autocannon = (await import("autocannon")).default;
} catch {
  console.error("⛔ autocannon is not installed. Run:  npm i -D autocannon");
  process.exit(1);
}

const API = process.env.LT_API || "http://localhost:5050";
const STAGES = String(arg("stages", "10,50,100,200")).split(",").map(Number).filter(Boolean);
const DURATION = arg("duration", 30);
const MIX = arg("mix", "all");

const state = loadState();
const tokens = state.users.map(u => u.token);
const mainToken = state.mainToken;
const campaignId = state.campaignIds.at(-1);

if (!campaignId) {
  console.warn("⚠️ No campaigns yet — campaign detail endpoints are skipped. Run create-campaigns.mjs first for a full test.");
}

// Endpoints the UI hits. `owner: true` ones need the campaign owner's token.
const POLL = [
  { path: "/api/campaigns/daily-limit" },
  { path: "/api/campaigns/accounts/locked" },
  { path: "/api/accounts" },
  ...(campaignId ? [{ path: `/api/campaigns/${campaignId}/progress`, owner: true }] : []),
];
const HEAVY = [
  { path: "/api/campaigns" },
  { path: "/api/campaigns/dashboard?range=all&page=1&pageSize=25" },
  { path: "/api/campaigns/for-followup?level=1&limit=6" },
  { path: "/api/campaigns/admin/daily-overview", owner: true },
  ...(campaignId
    ? [
        { path: `/api/campaigns/${campaignId}/view?page=1&pageSize=200`, owner: true },
        { path: `/api/campaigns/${campaignId}/recipients?status=sent`, owner: true },
      ]
    : []),
];
const ENDPOINTS = MIX === "poll" ? POLL : MIX === "heavy" ? HEAVY : [...POLL, ...HEAVY];

let counter = 0;
const requests = ENDPOINTS.map(ep => ({
  method: "GET",
  path: ep.path,
  setupRequest: (req) => {
    // Owner endpoints use the main user; the rest rotate across all users
    // so per-user caches behave like real traffic, not one hot key.
    const tok = ep.owner ? mainToken : tokens[counter++ % tokens.length];
    req.headers = { ...(req.headers || {}), authorization: `Bearer ${tok}` };
    return req;
  },
}));

function runStage(connections) {
  return new Promise((resolve, reject) => {
    const inst = autocannon(
      {
        url: API,
        connections,
        duration: DURATION,
        requests,
        timeout: 30,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    autocannon.track(inst, { renderProgressBar: true, renderResultsTable: false, renderLatencyTable: false });
  });
}

// Quick sanity check before hammering.
const probe = await fetch(`${API}/api/campaigns/daily-limit`, { headers: { authorization: `Bearer ${mainToken}` } }).catch(e => ({ ok: false, status: e.message }));
if (!probe.ok) {
  console.error(`⛔ API not ready at ${API} (${probe.status}). Start it with: node --env-file=loadtest/.env.loadtest server.js`);
  process.exit(1);
}

console.log(`🔫 API load test: ${ENDPOINTS.length} endpoints, stages ${STAGES.join(" → ")} connections, ${DURATION}s each\n`);

const rows = [];
for (const c of STAGES) {
  console.log(`\n▶ ${c} concurrent connections`);
  const r = await runStage(c);
  rows.push({
    conns: c,
    rps: r.requests.average,
    p50: r.latency.p50,
    p90: r.latency.p90,
    p99: r.latency.p99,
    max: r.latency.max,
    total: r.requests.total,
    s4xx: r["4xx"] || 0,
    s5xx: r["5xx"] || 0,
    netErrors: (r.errors || 0) + (r.timeouts || 0),
  });
  // Let the pool drain between stages.
  await new Promise(res => setTimeout(res, 3000));
}

console.log("\n═══════════════════════════ API RESULTS ═══════════════════════════");
console.log("conns    req/s   p50 ms   p90 ms   p99 ms   max ms    requests    4xx    5xx  net-err");
for (const r of rows) {
  console.log(
    String(r.conns).padStart(5) +
    fmt(r.rps).padStart(9) +
    String(r.p50).padStart(9) +
    String(r.p90).padStart(9) +
    String(r.p99).padStart(9) +
    String(r.max).padStart(9) +
    fmt(r.total).padStart(12) +
    String(r.s4xx).padStart(7) +
    String(r.s5xx).padStart(7) +
    String(r.netErrors).padStart(9)
  );
}
console.log("════════════════════════════════════════════════════════════════════");
console.log("How to read it:");
console.log("  • p99 under ~1000 ms and 0 5xx at your expected user count = healthy.");
console.log("  • 503s = the DB pool was exhausted (the API protected itself). Note that stage as your limit.");
console.log("  • req/s that stops rising while p99 climbs = you found the ceiling.");
