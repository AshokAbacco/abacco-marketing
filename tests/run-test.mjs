import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.PROCESS_ROLE = "worker";
process.env.DAILY_LOG_FLUSH_MS = "50";
process.env.JWT_SECRET = "x";

const S = new URL("../src", import.meta.url).pathname;
await import("@prisma/client");
await import("nodemailer");
const db = globalThis.__db;
const sent = globalThis.__sent;
const smtp = globalThis.__smtpBehaviour;

// ── Seed ─────────────────────────────────────────────────────────────────
db.user.push({ id: "u1", name: "Pawan", empId: "E1", email: "p@x.com", jobRole: "Employee", isActive: true });
db.user.push({ id: "u2", name: "Other", empId: "E2", email: "o@x.com", jobRole: "Employee", isActive: true });
db.emailAccount.push(
  { id: 1, userId: "u1", email: "alice@gmail.com", smtpHost: "localhost", smtpPort: 465, smtpUser: "alice@gmail.com", encryptedPass: "pw", provider: "gmail", senderName: "Alice", deleted: false },
  { id: 2, userId: "u1", email: "bob@gmail.com",   smtpHost: "localhost", smtpPort: 465, smtpUser: "bob@gmail.com",   encryptedPass: "pw", provider: "gmail", senderName: "Bob",   deleted: false },
);
const fast = JSON.stringify({ 1: 360000, 2: 360000 }); // 10 ms pacing

const mailer = await import(`${S}/services/campaignMailer.service.js`);
const ctrl = await import(`${S}/controllers/campaigns.controller.js`);
const imap = await import(`${S}/services/imap.service.js`);

function fakeRes() {
  return { statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; } };
}
const u1 = { id: "u1", jobRole: "Employee" };

// ── 1. createCampaign via controller (API never sends) ──────────────────
const emails = ["a1@test.com", "A1@test.com ", "a2@test.com", "bad-email", "a3@test.com", "a4@test.com", "a5@test.com", "perm@test.com"];
let res = fakeRes();
await ctrl.createCampaign({ user: u1, body: {
  campaignName: "Launch", subjects: ["Hello"], bodyHtml: "<p>Hi there</p>",
  recipients: emails, fromAccountIds: [1, 2], sendType: "immediate", customLimits: { 1: 360000, 2: 360000 },
}}, res);
assert.equal(res.body.success, true, JSON.stringify(res.body));
const c1 = db.campaign.find(c => c.id === res.body.data.id);
assert.equal(c1.status, "sending");
assert.equal(db.campaignRecipient.filter(r => r.campaignId === c1.id).length, 7, "dedupe + lowercase");
assert.equal(sent.length, 0, "API must not send");
console.log("✔ createCampaign: 7 unique recipients, status=sending, nothing sent by API");

// ownership: other user cannot send/delete it
res = fakeRes();
await ctrl.deleteCampaign({ user: { id: "u2", jobRole: "Employee" }, params: { id: String(c1.id) } }, res);
assert.equal(res.statusCode, 404);
console.log("✔ ownership enforced on delete");

// busy accounts reflect the sending campaign
res = fakeRes();
await ctrl.getLockedAccounts({ user: u1 }, res);
assert.deepEqual(res.body.data.busy.sort(), [1, 2]);
console.log("✔ busy accounts:", res.body.data.busy);

// ── 2. Worker sends it: one transient error, one permanent bounce ───────
const transient = Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" });
smtp.set("a2@test.com", [transient]);                                   // recovers inside sendWithRetry
smtp.set("perm@test.com", [Object.assign(new Error("550 no such user"), { responseCode: 550 })]);

const t0 = Date.now();
await Promise.all([mailer.sendBulkCampaign(c1.id), mailer.sendBulkCampaign(c1.id)]); // 2nd is a no-op (lock)
const rows1 = db.campaignRecipient.filter(r => r.campaignId === c1.id);
const byStatus = s => rows1.filter(r => r.status === s).map(r => r.email).sort();
console.log("  statuses:", { sent: byStatus("sent"), failed: byStatus("failed"), pending: byStatus("pending"), processing: byStatus("processing") }, `${Date.now() - t0}ms`);
assert.deepEqual(byStatus("sent"), ["a1@test.com", "a2@test.com", "a3@test.com", "a4@test.com", "a5@test.com"]);
assert.deepEqual(byStatus("failed"), ["bad-email", "perm@test.com"]);
assert.equal(c1.status, "completed");

const toC1 = sent.filter(m => m.headers["X-Abacco-Campaign"]?.startsWith(`${c1.id}-`));
assert.equal(toC1.length, 5, "each recipient exactly once");
assert.equal(new Set(toC1.map(m => m.to)).size, 5);
for (const m of toC1) {
  const r = rows1.find(r => r.email === m.to);
  assert.equal(m.messageId, `<campaign-${c1.id}-${r.id}@gmail.com>`);
  assert.ok(m.subject.startsWith("test - Hello"));
}
// both accounts used
assert.deepEqual([...new Set(toC1.map(m => m.via))].sort(), ["alice@gmail.com", "bob@gmail.com"]);
// sent records keyed by real Message-ID
assert.equal(db.emailMessage.length, 5);
assert.ok(db.emailMessage.every(m => m.messageId.startsWith("<campaign-")));
assert.ok(imap.isCampaignMessageId(db.emailMessage[0].messageId), "IMAP will skip these");
assert.ok(!imap.isCampaignMessageId("<CAF123@mail.gmail.com>"));
console.log("✔ send loop: 5 sent once each, 2 failed, campaign completed, Message-IDs deterministic");

// daily log buffered then flushed as one row
await mailer.flushDailyLog();
assert.equal(db.dailyEmailLog.length, 1);
assert.equal(db.dailyEmailLog[0].count, 5);
assert.equal(await mailer.getDailyCount("u1", { fresh: true }), 5);
console.log("✔ daily log: 1 row, count=5");

const tr = globalThis.__transports();
assert.equal(tr.transportsOpen, tr.transportsClosed, "all SMTP transporters closed");
console.log("✔ SMTP transporters closed:", tr);

// ── 3. Follow-up: threading + orphan handling ───────────────────────────
const cache = (await import(`${S}/utils/cache.js`)).default;
cache.del("busyAccounts"); // simulate the 5 s TTL expiring
res = fakeRes();
const senderMap = {};
for (const r of rows1.filter(r => r.status === "sent")) (senderMap[r.accountId] ||= []).push(r.email);
senderMap[1].push("never-sent@test.com"); // no sent original → must fail, not hang
await ctrl.createFollowupCampaign({ user: u1, body: {
  baseCampaignId: c1.id, subjects: [], bodyHtml: "<p>Just following up</p>", senderRecipientMap: senderMap,
}}, res);
assert.equal(res.body.success, true, JSON.stringify(res.body));
const f1 = db.campaign.find(c => c.id === res.body.data.id);
f1.customLimits = fast;

res = fakeRes();
await ctrl.sendFollowupCampaign({ user: u1, params: { id: String(f1.id) } }, res);
assert.equal(res.body.success, true);
assert.equal(f1.status, "sending");

await mailer.sendBulkCampaign(f1.id);
const rowsF = db.campaignRecipient.filter(r => r.campaignId === f1.id);
assert.equal(rowsF.filter(r => r.status === "sent").length, 5);
assert.equal(rowsF.find(r => r.email === "never-sent@test.com").status, "failed");
assert.equal(f1.status, "completed");

const fu = sent.filter(m => m.headers["X-Abacco-Campaign"]?.startsWith(`${f1.id}-`));
assert.equal(fu.length, 5);
for (const m of fu) {
  const orig = rows1.find(r => r.email === m.to);
  assert.equal(m.headers["In-Reply-To"], `<campaign-${c1.id}-${orig.id}@gmail.com>`, "threads to original");
  assert.equal(m.subject, `Re: Hello`);
  const origAcct = db.emailAccount.find(a => a.id === orig.accountId);
  assert.equal(m.via, origAcct.email, "sent from original sender");
  assert.ok(m.html.includes("Just following up") && m.html.includes("Hi there"), "quotes original");
}
console.log("✔ follow-up: 5 threaded replies from original senders, orphan failed, completed");

// ── 4. Stop mid-campaign: unsent rows go back to pending, status stays stopped
res = fakeRes();
const many = Array.from({ length: 30 }, (_, i) => `s${i}@test.com`);
await ctrl.createCampaign({ user: u1, body: {
  campaignName: "Slow", subjects: ["Yo"], bodyHtml: "<p>x</p>", recipients: many,
  fromAccountIds: [1], sendType: "immediate", customLimits: { 1: 36000 }, // 100 ms pacing
}}, res);
const c3 = db.campaign.find(c => c.id === res.body.data.id);
const run = mailer.sendBulkCampaign(c3.id);
await new Promise(r => setTimeout(r, 400));
res = fakeRes();
await ctrl.stopCampaign({ user: u1, params: { id: String(c3.id) } }, res);
assert.equal(res.body.success, true);
await run;
const rows3 = db.campaignRecipient.filter(r => r.campaignId === c3.id);
const sent3 = rows3.filter(r => r.status === "sent").length;
assert.equal(c3.status, "stopped");
assert.equal(rows3.filter(r => r.status === "processing").length, 0, "no rows left processing");
assert.ok(sent3 > 0 && sent3 < 30, `partially sent (${sent3})`);
assert.equal(rows3.filter(r => r.status === "pending").length, 30 - sent3);
console.log(`✔ stop: ${sent3} sent, ${30 - sent3} back to pending, status=stopped`);

// resume finishes the rest, nobody gets two emails
cache.del("busyAccounts");
res = fakeRes();
await ctrl.resendCampaign({ user: u1, params: { id: String(c3.id) } }, res);
assert.equal(res.body.success, true, JSON.stringify(res.body));
await mailer.sendBulkCampaign(c3.id);
assert.equal(c3.status, "completed");
const toC3 = sent.filter(m => m.headers["X-Abacco-Campaign"]?.startsWith(`${c3.id}-`));
assert.equal(toC3.length, 30);
assert.equal(new Set(toC3.map(m => m.to)).size, 30);
console.log("✔ resume: all 30 delivered exactly once");

// ── 5. Missing subjects: fail once instead of crashing every tick ───────
db.campaign.push({ id: 999, userId: "u1", status: "sending", sendType: "immediate", subject: "[]", bodyHtml: "x", pitchIds: "[]" });
db.campaignRecipient.push({ id: 5000, campaignId: 999, email: "z@test.com", status: "pending", accountId: 1, retryCount: 0 });
await mailer.sendBulkCampaign(999);
assert.equal(db.campaign.find(c => c.id === 999).status, "failed");
console.log("✔ bad campaign marked failed instead of retry-looping");

// ── 6. Scheduler flips due campaigns atomically ─────────────────────────
db.campaign.push({ id: 1001, name: "Sched", userId: "u1", status: "scheduled", scheduledAt: new Date(Date.now() - 1000) });
const prisma = (await import(`${S}/prismaClient.js`)).default;
const flipped = await prisma.$queryRaw`UPDATE "Campaign" SET "status" = 'sending' WHERE "status" = 'scheduled' RETURNING "id", "name"`;
assert.equal(flipped.length, 1);
console.log("✔ scheduler SQL path");

// ── 7. Daily-limit endpoint + progress cache key per user ───────────────
res = fakeRes();
await ctrl.getDailyLimitStatus({ user: u1 }, res);
assert.equal(res.body.data.dailySent, 5 + 5 + 30);
res = fakeRes();
await ctrl.getCampaignProgress({ user: { id: "u2", jobRole: "Employee" }, params: { id: String(c1.id) } }, res);
assert.equal(res.statusCode, 404, "other user can't read progress");
console.log("✔ daily limit =", 40, "and progress is per-user");

// ── 8. Auth middleware caches the user ──────────────────────────────────
const jwt = (await import("jsonwebtoken")).default;
const { protect, invalidateUserCache } = await import(`${S}/middlewares/authMiddleware.js`);
let lookups = 0;
const orig = prisma.user.findUnique;
prisma.user.findUnique = async (a) => { lookups++; return orig(a); };
const tok = jwt.sign({ id: "u1" }, "x");
for (let i = 0; i < 20; i++) {
  const r = fakeRes(); let ok = false;
  await protect({ headers: { authorization: `Bearer ${tok}` } }, r, () => { ok = true; });
  assert.ok(ok);
}
assert.equal(lookups, 1, "20 requests → 1 DB lookup");
db.user[0].isActive = false; invalidateUserCache("u1");
const r2 = fakeRes();
await protect({ headers: { authorization: `Bearer ${tok}` } }, r2, () => {});
assert.equal(r2.statusCode, 401);
assert.match(r2.body.error, /inactive/);
console.log("✔ protect: 20 requests → 1 query; deactivated user rejected");

console.log("\nALL TESTS PASSED");
process.exit(0);
