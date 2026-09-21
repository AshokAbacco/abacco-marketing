// Phase 4 end-to-end test: per-mailbox daily caps, warm-up, dashboard
// endpoints, domain checks, error-monitoring scrubbing.
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "phase4-secret";
process.env.PORT = "5081";
process.env.MAILBOX_ENCRYPTION_KEY = "f".repeat(64);
process.env.DAILY_LOG_FLUSH_MS = "50";
process.env.ACCOUNT_SEND_FLUSH_MS = "50";
process.env.DNS_TIMEOUT_MS = "1500";
process.env.CAP_RECHECK_MS = "500";
process.env.ACCOUNT_CAP_CACHE_MS = "500";

const S = new URL("../src", import.meta.url).pathname;
await import("@prisma/client");
await import("nodemailer");
const db = globalThis.__db;
const sent = globalThis.__sent;
const jwt = (await import("jsonwebtoken")).default;

db.user.push(
  { id: "admin", name: "Admin", email: "admin@x.com", jobRole: "Admin", isActive: true, password: "x" },
  { id: "u1", name: "Pawan", email: "pawan@x.com", jobRole: "Employee", isActive: true, password: "x" },
  { id: "u2", name: "Priya", email: "priya@x.com", jobRole: "Employee", isActive: true, password: "x" },
);
const acct = (id, userId, email, extra = {}) => ({
  id, userId, email, smtpHost: "localhost", smtpPort: 465, smtpUser: email, encryptedPass: "pw",
  provider: "gmail", senderName: email.split("@")[0], deleted: false, verified: true,
  sendingPausedAt: null, sendingPausedUntil: null, dailyCap: null, warmupEnabled: false,
  warmupStartAt: null, warmupStartCap: null, warmupTarget: null, ...extra,
});
db.emailAccount.push(
  acct(1, "u1", "alice@gmail.com"),
  acct(2, "u1", "bob@acme-mail.com", { provider: "custom" }),
  acct(3, "u2", "carol@gmail.com"),
);

await import(`${new URL("../server.js", import.meta.url).pathname}`);
const limits = await import(`${S}/services/sendingLimits.service.js`);
const mailer = await import(`${S}/services/campaignMailer.service.js`);
const domains = await import(`${S}/services/domainAuth.service.js`);
const obs = await import(`${S}/observability.js`);

const API = "http://localhost:5081";
const tok = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1h" });
const T = { admin: tok("admin"), u1: tok("u1"), u2: tok("u2") };
async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await sleep(300);

/* ══════════════════ 1. CAP CALCULATION ══════════════════ */
{
  const base = await limits.getSendingLimits();
  assert.equal(base.providerCaps.gmail, 100);

  const manual = limits.computeDailyCap({ provider: "gmail", dailyCap: 25 }, base);
  assert.deepEqual([manual.cap, manual.source], [25, "manual"]);
  const provider = limits.computeDailyCap({ provider: "gmail" }, base);
  assert.deepEqual([provider.cap, provider.source], [100, "provider"]);
  const unknown = limits.computeDailyCap({ provider: "weird-host" }, base);
  assert.deepEqual([unknown.cap, unknown.source], [base.defaultDailyCap, "default"]);

  // warm-up ramp: 10, 15, 20 … capped at the target
  const day = (n) => new Date(Date.now() - n * 86400e3);
  const warm = (n, extra = {}) => limits.computeDailyCap(
    { provider: "gmail", warmupEnabled: true, warmupStartAt: day(n), ...extra }, base
  );
  assert.deepEqual([warm(0).cap, warm(0).warmupDay], [10, 1]);
  assert.equal(warm(1).cap, 15);
  assert.equal(warm(4).cap, 30);
  assert.equal(warm(100).cap, 100, "stops at the target");
  assert.equal(warm(100, { warmupTarget: 40 }).cap, 40, "own target respected");
  assert.equal(warm(100, { warmupTarget: 5000 }).cap, 100, "never above the provider cap");
  assert.equal(warm(3, { dailyCap: 7 }).cap, 7, "manual cap wins over warm-up");
  assert.equal(limits.computeDailyCap({ provider: "gmail" }, { ...base, enabled: false }).cap, Infinity);

  // the sending day matches the engine's 5 PM window
  const start = limits.getSendingDayStart();
  assert.equal(start.getHours(), 17);
  assert.ok(limits.msUntilNextSendingDay() > 0 && limits.msUntilNextSendingDay() <= 86_400_000);
  console.log("✔ caps: manual > warm-up > provider > default; ramp stops at target and provider ceiling; window matches the engine");
}

/* ══════════════════ 2. ENGINE RESPECTS THE CAP ══════════════════ */
let c1;
{
  db.emailAccount.find(a => a.id === 1).dailyCap = 3;
  limits.invalidateCapCache();

  const r = await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Capped", subjects: ["Hi"], bodyHtml: "<p>hi</p>",
    recipients: ["a@t.com", "b@t.com", "c@t.com", "d@t.com", "e@t.com"],
    fromAccountIds: [1], sendType: "immediate", customLimits: { 1: 360000 },
  }});
  c1 = r.data.data.id;

  const run = mailer.sendBulkCampaign(c1);
  await sleep(2500);
  const rows = db.campaignRecipient.filter(x => x.campaignId === c1);
  assert.equal(rows.filter(x => x.status === "sent").length, 3, "stopped at the cap");
  assert.equal(rows.filter(x => x.status === "pending").length, 2, "the rest wait, not fail");
  assert.equal(rows.filter(x => x.status === "failed").length, 0);
  await limits.flushAccountSends();
  const counter = db.accountDailySend.find(x => x.accountId === 1);
  assert.equal(counter.count, 3);
  assert.equal(+counter.day, +limits.getSendingDayStart());
  assert.equal(await limits.getAccountSentToday(1, { fresh: true }), 3);

  // raising the cap lets the rest go
  db.emailAccount.find(a => a.id === 1).dailyCap = 10;
  limits.invalidateCapCache(1);
  await Promise.race([run, sleep(60_000)]);
  assert.equal(db.campaignRecipient.filter(x => x.campaignId === c1 && x.status === "sent").length, 5);
  assert.equal(db.campaign.find(c => c.id === c1).status, "completed");
  await limits.flushAccountSends();
  assert.equal(db.accountDailySend.find(x => x.accountId === 1).count, 5);
  assert.equal(sent.filter(m => m.headers["X-Abacco-Campaign"]?.startsWith(`${c1}-`)).length, 5, "each sent once");
  console.log("✔ engine: stops a mailbox at its cap (recipients wait), counts sends per mailbox, resumes when the cap rises");
}

/* ══════════════════ 3. CAP / WARM-UP API ══════════════════ */
{
  let r = await call("GET", "/api/deliverability/accounts", { token: T.u1 });
  const alice = r.data.data.find(a => a.email === "alice@gmail.com");
  assert.deepEqual([alice.dailyLimit, alice.limitSource, alice.sentToday, alice.capReached], [10, "manual", 5, false]);
  const bob = r.data.data.find(a => a.email === "bob@acme-mail.com");
  assert.deepEqual([bob.dailyLimit, bob.limitSource], [200, "provider"]);

  r = await call("PUT", "/api/deliverability/accounts/1/limits", { token: T.u2, body: { dailyCap: 50 } });
  assert.equal(r.status, 404, "not your mailbox");
  r = await call("PUT", "/api/deliverability/accounts/1/limits", { token: T.u1, body: { dailyCap: 0 } });
  assert.equal(r.status, 400);
  r = await call("PUT", "/api/deliverability/accounts/1/limits", { token: T.u1, body: { warmupStartCap: 40, warmupTarget: 20, warmupEnabled: true } });
  assert.equal(r.status, 400, "target below start");

  r = await call("PUT", "/api/deliverability/accounts/1/limits", { token: T.u1, body: { dailyCap: null, warmupEnabled: true, warmupStartCap: 10, warmupTarget: 60 } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.data.dailyLimit, r.data.data.limitSource, r.data.data.warmupDay], [10, "warmup", 1]);
  const row = db.emailAccount.find(a => a.id === 1);
  assert.ok(row.warmupStartAt, "warm-up start date set");

  // a restart resets day 1
  row.warmupStartAt = new Date(Date.now() - 6 * 86400e3);
  limits.invalidateCapCache(1);
  r = await call("GET", "/api/deliverability/accounts", { token: T.u1 });
  assert.deepEqual([r.data.data.find(a => a.id === 1).dailyLimit, r.data.data.find(a => a.id === 1).warmupDay], [40, 7]);
  r = await call("PUT", "/api/deliverability/accounts/1/limits", { token: T.admin, body: { warmupEnabled: true, restartWarmup: true } });
  assert.equal(r.data.data.warmupDay, 1);

  // company-wide settings
  r = await call("GET", "/api/deliverability/settings/sending-limits", { token: T.u1 });
  assert.equal(r.data.canEdit, false);
  assert.equal(r.data.data.providerCaps.gmail, 100);
  assert.ok(r.data.providersInUse.length);
  const body = structuredClone(r.data.data);
  body.providerCaps.gmail = 45;
  r = await call("PUT", "/api/deliverability/settings/sending-limits", { token: T.u1, body });
  assert.equal(r.status, 403);
  r = await call("PUT", "/api/deliverability/settings/sending-limits", { token: T.admin, body: { ...body, warmup: { ...body.warmup, startCap: 50, targetCap: 20 } } });
  assert.equal(r.status, 400);
  r = await call("PUT", "/api/deliverability/settings/sending-limits", { token: T.admin, body });
  assert.equal(r.status, 200);
  limits.invalidateCapCache();
  const cap = await limits.getAccountCap(3, { fresh: true });
  assert.equal(cap.cap, 45, "new provider cap applies to other mailboxes");
  console.log("✔ cap API: ownership, validation, warm-up start/restart, company settings (admin only) apply everywhere");
}

/* ══════════════════ 4. DOMAIN CHECKS ══════════════════ */
{
  const free = await domains.checkDomain("GMAIL.com");
  assert.deepEqual([free.free, free.status], [true, "provider"]);
  assert.match(free.note, /own domain/);

  const own = await domains.checkDomain("definitely-not-a-real-domain-xyz123.test");
  assert.equal(own.free, false);
  assert.equal(own.status, "missing");
  assert.deepEqual([own.spf.ok, own.dkim.ok, own.dmarc.ok], [false, false, false]);
  assert.match(own.note, /No SPF record/);

  let r = await call("GET", "/api/deliverability/domains", { token: T.u1 });
  assert.equal(r.status, 200);
  const list = r.data.data.domains;
  assert.deepEqual(list.map(d => d.domain).sort(), ["acme-mail.com", "gmail.com"]);
  assert.equal(list.find(d => d.domain === "gmail.com").mailboxes, 1, "only this user's mailboxes");
  r = await call("GET", "/api/deliverability/domains", { token: T.admin });
  assert.equal(r.data.data.domains.find(d => d.domain === "gmail.com").mailboxes, 2, "admin sees all");
  console.log("✔ domains: free providers flagged, missing SPF/DKIM/DMARC reported, scoped per user");
}

/* ══════════════════ 5. TRENDS + PURGE + MONITORING ══════════════════ */
{
  let r = await call("GET", "/api/deliverability/trends?days=7", { token: T.u1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.data.totals, { sent: 0, replies: 0, bounces: 0, hardBounces: 0, optouts: 0, replyRate: 0, bounceRate: 0, hardBounceRate: 0, optoutRate: 0 });
  assert.equal(r.data.data.scope, "mine");
  r = await call("GET", "/api/deliverability/trends?days=999", { token: T.admin });
  assert.equal(r.data.data.scope, "company", "days clamped, admin sees company-wide");

  // housekeeping
  db.accountDailySend.push({ id: 9999, accountId: 1, day: new Date(Date.now() - 200 * 86400e3), count: 12 });
  assert.equal(await limits.purgeOldDailySends(120), 1);
  assert.equal(db.accountDailySend.some(x => x.id === 9999), false);

  // error monitoring is off without a DSN, and never leaks secrets
  assert.equal(obs.observabilityEnabled(), false);
  obs.captureError(new Error("boom"), { tags: { job: "x" } }); // must not throw
  assert.deepEqual(
    obs.scrub({ email: "a@b.c", password: "hunter2", nested: { apiKey: "k", encryptedPass: "v2:…", ok: 1 } }),
    { email: "a@b.c", password: "[redacted]", nested: { apiKey: "[redacted]", encryptedPass: "[redacted]", ok: 1 } }
  );
  assert.equal(obs.scrub("x".repeat(600)).length, 501);
  console.log("✔ trends endpoint + counter purge + monitoring off by default and redacts credentials");
}

console.log("\nPHASE 4 END-TO-END TESTS PASSED");
process.exit(0);
