// loadtest/create-campaigns.mjs
//
// Creates campaigns THROUGH THE API (so request handling, validation and
// bulk insert are part of the test). The worker then sends them to Mailpit.
//
//   node --env-file=loadtest/.env.loadtest loadtest/create-campaigns.mjs --campaigns=5 --recipients=2000 --rate=36000
//
//   --campaigns    number of campaigns                      (default 3)
//   --recipients   recipients per campaign                  (default 1000)
//   --accounts     sender accounts per campaign             (default: all, split evenly)
//   --rate         per-account hourly limit (customLimits)  (default 36000 = 1 email / 100 ms)
//   --scheduled    minutes from now to schedule instead of immediate (default: immediate)

import { arg, loadState, saveState, fmt } from "./lib.mjs";

const API = process.env.LT_API || "http://localhost:5050";
const CAMPAIGNS = arg("campaigns", 3);
const RECIPIENTS = arg("recipients", 1000);
const RATE = arg("rate", 36000);
const SCHEDULED = arg("scheduled", "");

const state = loadState();
const all = state.accountIds;
const perCampaign = Math.max(1, Math.min(arg("accounts", Math.floor(all.length / CAMPAIGNS) || 1), all.length));

// Busy accounts can't be reused by an immediate campaign, so give each
// campaign its own slice of accounts.
if (!SCHEDULED && perCampaign * CAMPAIGNS > all.length) {
  console.error(
    `⛔ ${CAMPAIGNS} campaigns × ${perCampaign} accounts needs ${perCampaign * CAMPAIGNS} accounts, ` +
    `but only ${all.length} were seeded. Re-run seed with --accounts=${perCampaign * CAMPAIGNS}.`
  );
  process.exit(1);
}

const runId = Date.now().toString(36);
console.log(`📨 Creating ${CAMPAIGNS} campaign(s) × ${fmt(RECIPIENTS)} recipients, ${perCampaign} accounts each, ${fmt(RATE)}/hr per account`);

for (let c = 0; c < CAMPAIGNS; c++) {
  const fromAccountIds = all.slice(c * perCampaign, c * perCampaign + perCampaign);
  const recipients = Array.from({ length: RECIPIENTS }, (_, i) => `r${i}.c${c}.${runId}@loadtest.local`);
  const customLimits = Object.fromEntries(fromAccountIds.map(id => [id, RATE]));

  const body = {
    campaignName: `LT-${runId}-${c + 1}`,
    subjects: ["Load test A", "Load test B", "Load test C"],
    bodyHtml: `<div style="font-family:Calibri"><p>Hello, this is load-test email ${c + 1}.</p>${"<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>".repeat(20)}</div>`,
    recipients,
    fromAccountIds,
    pitchIds: [],
    sendType: SCHEDULED ? "scheduled" : "immediate",
    scheduledAt: SCHEDULED ? new Date(Date.now() + Number(SCHEDULED) * 60_000).toISOString() : null,
    customLimits,
    senderRole: "Load Tester",
  };

  const t0 = performance.now();
  const res = await fetch(`${API}/api/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.mainToken}` },
    body: JSON.stringify(body),
  });
  const ms = performance.now() - t0;
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.success) {
    console.error(`❌ Campaign ${c + 1}: HTTP ${res.status} ${json.message || ""} (${ms.toFixed(0)} ms)`);
    continue;
  }

  state.campaignIds.push(json.data.id);
  console.log(`✅ Campaign ${json.data.id} "${body.campaignName}" created in ${ms.toFixed(0)} ms (status=${json.data.status})`);
}

saveState(state);
console.log("\nNow watch it with:  node --env-file=loadtest/.env.loadtest loadtest/monitor.mjs");
