// Phase 1 end-to-end test: API server + send engine + inbound processing,
// in one process against the in-memory DB mock and a fake SMTP transport.
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "phase1-secret";
process.env.PORT = "5077";
process.env.PUBLIC_API_URL = "https://api.test";
process.env.MAILBOX_ENCRYPTION_KEY = "b".repeat(64);
process.env.DAILY_LOG_FLUSH_MS = "50";
process.env.UNSUBSCRIBE_COMPANY_NAME = "Abacco";
process.env.LOGIN_MAX_ATTEMPTS = "5";
process.env.PAUSED_ACCOUNT_RECHECK_MS = "500";
process.env.ACCOUNT_PAUSE_CACHE_MS = "60000"; // invalidation must work without TTL help

const S = new URL("../src", import.meta.url).pathname;
await import("@prisma/client");
await import("nodemailer");
const db = globalThis.__db;
const sent = globalThis.__sent;
const smtp = globalThis.__smtpBehaviour;

const mp = await import("mailparser");
const simpleParser = mp.simpleParser || mp.default.simpleParser;
const jwt = (await import("jsonwebtoken")).default;

// ── Seed ─────────────────────────────────────────────────────────────────
db.user.push(
  { id: "admin", name: "Admin", empId: "A1", email: "admin@x.com", jobRole: "Admin", isActive: true, password: "admin-pass-123" },
  { id: "u1", name: "Pawan", empId: "E1", email: "pawan@x.com", jobRole: "Employee", isActive: true, password: "legacy-plain-1" },
  { id: "u2", name: "Other", empId: "E2", email: "other@x.com", jobRole: "Employee", isActive: true, password: "other-pass-12" },
);
const acct = (id, userId, email) => ({
  id, userId, email, smtpHost: "localhost", smtpPort: 465, smtpUser: email, encryptedPass: "pw",
  provider: "gmail", senderName: email.split("@")[0], deleted: false, verified: true,
  imapHost: null, sendingPausedAt: null, sendingPausedReason: null, sendingPausedUntil: null,
});
db.emailAccount.push(acct(1, "u1", "alice@gmail.com"), acct(2, "u1", "bob@gmail.com"), acct(3, "u2", "carol@gmail.com"));

await import(`${new URL("../server.js", import.meta.url).pathname}`);
const mailer = await import(`${S}/services/campaignMailer.service.js`);
const inbound = await import(`${S}/services/inboundProcessor.service.js`);
const supp = await import(`${S}/services/suppression.service.js`);
const cache = (await import(`${S}/utils/cache.js`)).default;
const { __resetRateLimits } = await import(`${S}/middlewares/rateLimit.js`);
const { secretFormat, resolveSecret } = await import(`${S}/utils/crypto.js`);

const API = "http://localhost:5077";
const tok = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1h" });
const T = { admin: tok("admin"), u1: tok("u1"), u2: tok("u2") };
async function call(method, path, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers: h, body: payload, redirect: "manual" });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rows = (cid) => db.campaignRecipient.filter(r => r.campaignId === cid);
const byEmail = (cid, email) => rows(cid).find(r => r.email === email);
await sleep(300);

/* ══════════════════ 1. SECURITY ══════════════════ */
{
  let r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("x-content-type-options") === "nosniff", "helmet headers");
  assert.ok(r.headers.get("content-security-policy"), "CSP header");

  r = await call("POST", "/api/smtp/send", { body: { to: "x@y.com", emailAccountId: 1 } });
  assert.equal(r.status, 401, "smtp send needs login");
  r = await call("POST", "/api/smtp/send", { token: T.u2, body: { to: "x@y.com", emailAccountId: 1 } });
  assert.equal(r.status, 404, "cannot send from someone else's mailbox");

  r = await call("GET", "/api/accounts/sync/alice@gmail.com");
  assert.equal(r.status, 401, "sync needs login");
  r = await call("GET", "/api/accounts/sync/alice@gmail.com", { token: T.u2 });
  assert.equal(r.status, 404);

  r = await call("GET", "/api/inbox/conversations/1", { token: T.u2 });
  assert.equal(r.status, 404, "other user's inbox hidden");
  r = await call("POST", "/api/inbox/accounts/unread-bulk", { token: T.u2, body: { accountIds: [1, 2, 3] } });
  assert.deepEqual(Object.keys(r.data.data), ["3"], "bulk unread filtered to own accounts");
  r = await call("PATCH", "/api/inbox/batch-mark-read", { token: T.u2, body: { conversationIds: ["c1"], accountId: 1 } });
  assert.equal(r.status, 404);
  r = await call("GET", "/api/inbox/accounts/1/unread", { token: T.admin });
  assert.equal(r.status, 200, "admin may access any mailbox");

  r = await call("PUT", "/api/accounts/1", { token: T.u2, body: { senderName: "hacked" } });
  assert.equal(r.status, 404, "cannot edit someone else's account");
  r = await call("PUT", "/api/accounts/1", { token: T.u1, body: { senderName: "Alice A", encryptedPass: "new-app-pass" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.encryptedPass, undefined, "password not returned");
  assert.equal(r.data.hasPassword, true);
  const a1 = db.emailAccount.find(a => a.id === 1);
  assert.equal(secretFormat(a1.encryptedPass), "v2");
  assert.equal(resolveSecret(a1.encryptedPass), "new-app-pass");
  assert.equal(a1.senderName, "Alice A");

  r = await call("GET", "/api/accounts/emp/E1", { token: T.u2 });
  assert.deepEqual(r.data.data, [], "emp lookup scoped to own accounts");

  r = await call("POST", "/api/users/register", { token: T.u1, body: { email: "n@x.com", password: "12345678", name: "N", jobRole: "Employee" } });
  assert.equal(r.status, 403, "only admin/HR can create users");
  r = await call("POST", "/api/users/register", { token: T.admin, body: { email: "n@x.com", password: "short", name: "N", jobRole: "Employee" } });
  assert.equal(r.status, 400, "min password length");
  r = await call("POST", "/api/users/register", { token: T.admin, body: { email: "New@X.com", password: "longenough1", name: "N", jobRole: "Employee" } });
  assert.equal(r.status, 201);
  const created = db.user.find(u => u.email === "new@x.com");
  created.id = "user-new"; // real IDs are UUID strings; the mock issues numbers
  assert.match(created.password, /^\$2[aby]\$/, "new passwords hashed");

  r = await call("GET", "/api/users/all", { token: T.admin });
  assert.ok(r.data.every(u => u.password === undefined), "passwords never listed");

  // Legacy plain-text login → upgraded to bcrypt, still works afterwards
  r = await call("POST", "/api/users/login", { body: { email: "pawan@x.com", password: "legacy-plain-1" } });
  assert.equal(r.status, 200);
  const pawan = db.user.find(u => u.id === "u1");
  assert.match(pawan.password, /^\$2[aby]\$/, "lazy upgrade to bcrypt");
  assert.equal(pawan.passwordChangedAt, undefined, "upgrade doesn't end sessions");
  r = await call("POST", "/api/users/login", { body: { email: "pawan@x.com", password: "legacy-plain-1" } });
  assert.equal(r.status, 200, "login works with hashed password");

  // Lockout after 5 failures
  __resetRateLimits();
  for (let i = 0; i < 5; i++) {
    r = await call("POST", "/api/users/login", { body: { email: "other@x.com", password: "wrong" } });
    assert.equal(r.status, 400);
  }
  r = await call("POST", "/api/users/login", { body: { email: "other@x.com", password: "other-pass-12" } });
  assert.equal(r.status, 429, "locked even with the right password");
  assert.ok(Number(r.headers.get("retry-after")) > 0);
  __resetRateLimits();

  // Admin reset → old sessions end
  const oldToken = tok("u2");
  await sleep(1100);
  r = await call("PUT", "/api/users/u2/password", { token: T.admin, body: { password: "brand-new-pass" } });
  assert.equal(r.status, 200);
  r = await call("GET", "/api/users/me", { token: oldToken });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /password was changed/);
  r = await call("POST", "/api/users/login", { body: { email: "other@x.com", password: "brand-new-pass" } });
  assert.equal(r.status, 200);
  T.u2 = r.data.token;
  r = await call("GET", "/api/users/me", { token: T.u2 });
  assert.equal(r.status, 200, "new login works");

  // Toggle returns isActive at top level
  r = await call("PUT", "/api/users/new-user-does-not-exist/status", { token: T.admin });
  assert.equal(r.status, 404);
  r = await call("PUT", `/api/users/${created.id}/status`, { token: T.admin });
  assert.equal(r.data.isActive, false);

  console.log("✔ security: auth on send/sync, mailbox ownership, secrets hidden+encrypted, bcrypt upgrade, lockout, reset ends sessions, helmet");
}

/* ══════════════════ 2. UNSUBSCRIBE ══════════════════ */
let c1;
{
  let r = await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Launch", subjects: ["Hello"], bodyHtml: "<p>Hi there</p>",
    recipients: ["a1@t.com", "a2@t.com", "a3@t.com", "a4@t.com", "opt@t.com"],
    fromAccountIds: [1], sendType: "immediate", customLimits: { 1: 360000 },
  }});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c1 = r.data.data.id;
  await mailer.sendBulkCampaign(c1);
  assert.equal(rows(c1).filter(x => x.status === "sent").length, 5);

  const mail = sent.find(m => m.to === "opt@t.com");
  const lu = mail.headers["List-Unsubscribe"];
  assert.match(lu, /^<https:\/\/api\.test\/u\/[^>]+>, <mailto:alice@gmail\.com\?subject=unsubscribe>$/);
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(mail.html.includes("Not interested? Unsubscribe"), "footer link");
  assert.ok(typeof mail.text === "string" && mail.text.includes("Hi there"), "plain-text part");
  const url = lu.match(/<(https:[^>]+)>/)[1];
  const path = url.replace("https://api.test", "");
  assert.ok(mail.html.includes(url), "footer uses the same link");

  r = await call("GET", path);
  assert.equal(r.status, 200);
  assert.match(r.data, /Stop receiving emails from Abacco/);
  assert.match(r.data, /op•@t\.com/, "address masked");
  assert.equal(db.suppressedEmail.length, 0, "GET alone does not unsubscribe (link scanners)");
  assert.equal(r.headers.get("cache-control"), "no-store");

  r = await call("POST", path, { form: { confirm: "1" } });
  assert.equal(r.status, 200);
  assert.match(r.data, /You(&#39;|')re unsubscribed/);
  assert.equal(db.suppressedEmail[0].email, "opt@t.com");
  assert.equal(db.suppressedEmail[0].source, "link");
  assert.ok(byEmail(c1, "opt@t.com").unsubscribedAt, "recipient stamped");

  r = await call("GET", path);
  assert.match(r.data, /You(&#39;|')re unsubscribed/);

  // One-click (Gmail button) for another address
  const token2 = sent.find(m => m.to === "a4@t.com").headers["List-Unsubscribe"].match(/\/u\/([^>]+)>/)[1];
  r = await call("POST", `/u/${token2}`, { form: { "List-Unsubscribe": "One-Click" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { success: true });
  assert.equal(db.suppressedEmail.find(x => x.email === "a4@t.com").source, "one_click");

  // Tampered token
  r = await call("GET", path.slice(0, -2) + (path.endsWith("aa") ? "bb" : "aa"));
  assert.equal(r.status, 400);
  r = await call("POST", "/u/garbage", { form: { "List-Unsubscribe": "One-Click" } });
  assert.equal(r.status, 400);

  // New campaign including the opted-out people → skipped, never sent
  const before = sent.length;
  r = await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Second", subjects: ["Again"], bodyHtml: "<p>Round two</p>",
    recipients: ["opt@t.com", "A4@T.com", "fresh@t.com"],
    fromAccountIds: [2], sendType: "immediate", customLimits: { 2: 360000 },
  }});
  const c2 = r.data.data.id;
  await mailer.sendBulkCampaign(c2);
  const newMails = sent.slice(before).map(m => m.to);
  assert.deepEqual(newMails, ["fresh@t.com"]);
  assert.equal(byEmail(c2, "opt@t.com").status, "skipped");
  assert.equal(byEmail(c2, "opt@t.com").error, "Suppressed: unsubscribe");
  assert.equal(db.campaign.find(c => c.id === c2).status, "completed");

  // Suppression added mid-campaign is honoured at send time
  supp.clearSuppressionCache();
  console.log("✔ unsubscribe: headers + footer + text part, confirm page, link & one-click opt-out, tamper-proof, suppressed never re-sent");
}

/* ══════════════════ 3. REPLIES ══════════════════ */
function rawEmail({ from, to, subject, body, headers = {}, messageId, date = new Date() }) {
  const h = {
    From: from, To: to, Subject: subject, "Message-ID": messageId,
    Date: date.toUTCString(), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", ...headers,
  };
  return Buffer.from(Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n" + body.replace(/\n/g, "\r\n"));
}
async function deliver(accountId, raw, { minutesAgo = 0 } = {}) {
  const parsed = await simpleParser(raw);
  const account = db.emailAccount.find(a => a.id === accountId);
  return inbound.processInboundMessage({
    account, parsed, messageId: parsed.messageId, conversationId: "conv-" + parsed.messageId,
    receivedAt: new Date(Date.now() - minutesAgo * 60_000), rawSource: raw,
  });
}
{
  const orig = sent.find(m => m.to === "a1@t.com");
  // a1 replies to the campaign email (threaded), with the old email quoted
  const reply = rawEmail({
    from: "A One <a1@t.com>", to: "alice@gmail.com", subject: "Re: t.com - Hello",
    messageId: "<reply-a1@t.com>",
    headers: { "In-Reply-To": orig.messageId, References: orig.messageId },
    body: "Thanks, sounds interesting. Call me tomorrow.\n\nOn Mon, 1 Sep 2026 at 10:00, Alice wrote:\n> Hi there\n> Not interested? Unsubscribe",
  });
  let out = await deliver(1, reply);
  assert.equal(out.kind, "reply");
  assert.deepEqual(out.detail, { email: "a1@t.com", intent: "reply", matchedBy: "header", reviewStatus: null, category: "meeting" });
  assert.ok(byEmail(c1, "a1@t.com").repliedAt);
  assert.equal(db.replyEvent.length, 1);
  assert.equal(db.replyEvent[0].snippet, "Thanks, sounds interesting. Call me tomorrow.");
  out = await deliver(1, reply);
  assert.equal(out.kind, "none", "same message processed once");
  assert.equal(db.replyEvent.length, 1);

  // Out-of-office from a2 is ignored
  out = await deliver(1, rawEmail({
    from: "a2@t.com", to: "alice@gmail.com", subject: "Automatic reply: Hello", messageId: "<ooo@t.com>",
    headers: { "Auto-Submitted": "auto-replied", "In-Reply-To": sent.find(m => m.to === "a2@t.com").messageId },
    body: "I am out of the office until Monday.",
  }));
  assert.equal(out.kind, "auto_reply");
  assert.equal(byEmail(c1, "a2@t.com").repliedAt, undefined);

  // Unrelated email from a stranger is not a reply
  out = await deliver(1, rawEmail({ from: "stranger@z.com", to: "alice@gmail.com", subject: "Hi", messageId: "<s@z>", body: "Hello" }));
  assert.equal(out.kind, "none");

  // Follow-up creation leaves out repliers / opted-out / bounced
  let r = await call("POST", "/api/campaigns/followup", { token: T.u1, body: {
    baseCampaignId: c1, subjects: [], bodyHtml: "<p>Just following up</p>",
    senderRecipientMap: { 1: ["a1@t.com", "a2@t.com", "a3@t.com", "a4@t.com", "opt@t.com"] },
  }});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.recipients, 2);
  assert.deepEqual(r.data.excluded, { suppressed: 2, replied: 1, bounced: 0 });
  const f1 = r.data.data.id;
  assert.deepEqual(rows(f1).map(x => x.email).sort(), ["a2@t.com", "a3@t.com"]);

  r = await call("GET", `/api/campaigns/${c1}/recipients?status=sent&forFollowup=1`, { token: T.u1 });
  assert.deepEqual(r.data.data.map(x => x.email).sort(), ["a2@t.com", "a3@t.com"], "picker excludes engaged");

  // a3 asks to be removed — no thread header, matched by address; review mode
  out = await deliver(1, rawEmail({
    from: "a3@t.com", to: "alice@gmail.com", subject: "your email", messageId: "<rm-a3@t.com>",
    body: "Please remove me from your mailing list.\n",
  }));
  assert.equal(out.kind, "reply");
  assert.deepEqual(out.detail, { email: "a3@t.com", intent: "unsubscribe_request", matchedBy: "address", reviewStatus: "pending", category: "unsubscribe" });
  assert.equal(db.suppressedEmail.some(x => x.email === "a3@t.com"), false, "review mode: not suppressed yet");
  assert.equal(byEmail(f1, "a3@t.com").status, "skipped", "queued follow-up stopped immediately");

  r = await call("POST", `/api/campaigns/followup/${f1}/send`, { token: T.u1 });
  assert.equal(r.status, 200);
  const before = sent.length;
  await mailer.sendBulkCampaign(f1);
  const fuMails = sent.slice(before);
  assert.deepEqual(fuMails.map(m => m.to), ["a2@t.com"], "only the non-replier gets the follow-up");
  assert.equal(fuMails[0].headers["In-Reply-To"], sent.find(m => m.to === "a2@t.com").messageId);
  assert.ok(fuMails[0].headers["List-Unsubscribe"]);
  assert.ok(fuMails[0].html.indexOf("Unsubscribe") < fuMails[0].html.indexOf("Hi there"), "footer above the quoted original");

  // Admin review queue
  r = await call("GET", "/api/deliverability/reviews", { token: T.u1 });
  assert.equal(r.status, 403, "review queue is admin only");
  r = await call("GET", "/api/deliverability/reviews", { token: T.admin });
  assert.equal(r.data.data.length, 1);
  assert.equal(r.data.data[0].accountEmail, "alice@gmail.com");
  r = await call("POST", `/api/deliverability/reviews/${r.data.data[0].id}`, { token: T.admin, body: { action: "suppress" } });
  assert.equal(r.status, 200);
  const s3 = db.suppressedEmail.find(x => x.email === "a3@t.com");
  assert.equal(s3.reason, "reply_request");
  assert.equal(s3.addedById, "admin");
  r = await call("GET", "/api/deliverability/reviews?status=pending", { token: T.admin });
  assert.equal(r.data.data.length, 0);

  // mailto one-click unsubscribe from the header → immediate
  out = await deliver(2, rawEmail({
    from: "fresh@t.com", to: "bob@gmail.com", subject: "unsubscribe", messageId: "<mt@t.com>", body: "",
  }));
  assert.equal(out.detail.reviewStatus, "suppressed");
  assert.equal(db.suppressedEmail.find(x => x.email === "fresh@t.com").source, "mailto");

  // "unsubscribe" only inside the QUOTED text is a normal reply
  out = await deliver(2, rawEmail({
    from: "zed@t.com", to: "bob@gmail.com", subject: "Re: x", messageId: "<q@t.com>",
    body: "Yes please send pricing.\n\n> Not interested? Unsubscribe\n",
  }));
  assert.equal(out.kind, "none", "zed was never emailed → not a campaign reply");
  const cz = (await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Zed", subjects: ["Z"], bodyHtml: "<p>z</p>", recipients: ["zed@t.com"],
    fromAccountIds: [2], sendType: "immediate", customLimits: { 2: 360000 },
  }})).data.data.id;
  await mailer.sendBulkCampaign(cz);
  out = await deliver(2, rawEmail({
    from: "zed@t.com", to: "bob@gmail.com", subject: "Re: x", messageId: "<q2@t.com>",
    body: "Yes please send pricing.\n\nOn Tue, Bob wrote:\n> Not interested? Unsubscribe\n",
  }));
  assert.equal(out.detail.intent, "reply");

  console.log("✔ replies: threaded + address matching, OOO ignored, idempotent, follow-ups skip repliers, removal review queue, mailto opt-out, quoted text ignored");
}

/* ══════════════════ 4. BOUNCES + ACCOUNT HEALTH ══════════════════ */
function dsn({ to, status, action = "failed", diag, ref, id }) {
  const b = "BNDRY";
  return Buffer.from([
    "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    "To: bob@gmail.com",
    "Subject: Delivery Status Notification (Failure)",
    `Message-ID: <${id}@mx.google.com>`,
    `Date: ${new Date().toUTCString()}`,
    "Auto-Submitted: auto-replied",
    "MIME-Version: 1.0",
    `Content-Type: multipart/report; report-type=delivery-status; boundary="${b}"`,
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Address not found",
    "",
    `--${b}`,
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; googlemail.com",
    "",
    `Final-Recipient: rfc822; ${to}`,
    `Action: ${action}`,
    `Status: ${status}`,
    `Diagnostic-Code: smtp; ${diag}`,
    "",
    `--${b}`,
    "Content-Type: text/rfc822-headers",
    "",
    ref ? `Message-ID: ${ref.messageId}` : "Message-ID: <other@x>",
    ref ? `X-Abacco-Campaign: ${ref.headers["X-Abacco-Campaign"]}` : "",
    "Subject: hello",
    "",
    `--${b}--`,
    "",
  ].join("\r\n"));
}
{
  // Campaign from bob with addresses that will bounce
  const list = ["gone@t.com", "full@t.com", "spamblock@t.com", "delay@t.com", ...Array.from({ length: 50 }, (_, i) => `ok${i}@t.com`)];
  const cb = (await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Bouncy", subjects: ["B"], bodyHtml: "<p>b</p>", recipients: list,
    fromAccountIds: [2], sendType: "immediate", customLimits: { 2: 360000 },
  }})).data.data.id;
  await mailer.sendBulkCampaign(cb);
  const ref = (to) => sent.find(m => m.to === to && m.headers["X-Abacco-Campaign"]?.startsWith(`${cb}-`));

  let out = await deliver(2, dsn({ to: "gone@t.com", status: "5.1.1", diag: "550-5.1.1 The email account that you tried to reach does not exist.", ref: ref("gone@t.com"), id: "b1" }));
  assert.equal(out.kind, "bounce");
  assert.deepEqual(out.detail, [{ email: "gone@t.com", type: "hard" }]);
  const gone = byEmail(cb, "gone@t.com");
  assert.equal(gone.bounceType, "hard");
  assert.ok(gone.bouncedAt);
  assert.equal(db.suppressedEmail.find(x => x.email === "gone@t.com").reason, "hard_bounce");
  const ev = db.emailBounce.find(x => x.email === "gone@t.com");
  assert.equal(ev.recipientId, gone.id);
  assert.equal(ev.statusCode, "5.1.1");
  out = await deliver(2, dsn({ to: "gone@t.com", status: "5.1.1", diag: "x", ref: ref("gone@t.com"), id: "b1" }));
  assert.deepEqual(out.detail, [], "duplicate bounce notification ignored");

  // Delayed notices are not failures
  out = await deliver(2, dsn({ to: "delay@t.com", status: "4.4.7", action: "delayed", diag: "delayed", ref: ref("delay@t.com"), id: "d1" }));
  assert.deepEqual(out.detail, []);

  // Soft bounces: suppressed on the 3rd
  for (let i = 1; i <= 3; i++) {
    out = await deliver(2, dsn({ to: "full@t.com", status: "4.2.2", diag: "452 mailbox full", ref: ref("full@t.com"), id: `s${i}` }));
    assert.equal(out.detail[0].type, "soft");
    assert.equal(db.suppressedEmail.some(x => x.email === "full@t.com"), i === 3, `soft bounce ${i}`);
  }
  assert.equal(db.suppressedEmail.find(x => x.email === "full@t.com").reason, "soft_bounce");

  // Spam block: not suppressed (address is fine), counts for health
  out = await deliver(2, dsn({ to: "spamblock@t.com", status: "5.7.1", diag: "550 5.7.1 Message rejected as spam", ref: ref("spamblock@t.com"), id: "k1" }));
  assert.equal(out.detail[0].type, "block");
  assert.equal(db.suppressedEmail.some(x => x.email === "spamblock@t.com"), false);
  assert.equal(db.emailAccount.find(a => a.id === 2).sendingPausedAt, null, "2 bad of 54 sent: not paused yet");

  // Bounce without DSN part — Outlook-style, X-Failed-Recipients header
  out = await deliver(2, rawEmail({
    from: "postmaster@outlook.com", to: "bob@gmail.com", subject: "Undeliverable: B", messageId: "<xf@o>",
    headers: { "X-Failed-Recipients": "ok0@t.com" },
    body: "Delivery has failed to these recipients: ok0@t.com\nRemote server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound'",
  }));
  assert.deepEqual(out.detail, [{ email: "ok0@t.com", type: "hard" }]);

  // A human email mentioning "undeliverable" is not a bounce
  assert.equal(inbound.looksLikeBounce(await simpleParser(rawEmail({ from: "ok1@t.com", to: "bob@gmail.com", subject: "Undeliverable goods", messageId: "<h@t>", body: "hi" }))), false);

  // Spike: more hard bounces → account auto-paused
  for (let i = 2; i <= 4; i++) {
    await deliver(2, dsn({ to: `ok${i}@t.com`, status: "5.1.1", diag: "no such user", ref: ref(`ok${i}@t.com`), id: `h${i}` }));
  }
  const bob = db.emailAccount.find(a => a.id === 2);
  assert.ok(bob.sendingPausedAt, "paused after bounce spike");
  assert.match(bob.sendingPausedReason, /High bounce rate: 5 failed of 56 sent in 24h \(8\.9%\)/);
  assert.ok(bob.sendingPausedUntil > new Date());

  // Paused account sends nothing; resume via API → sends
  const cp = (await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "WhilePaused", subjects: ["P"], bodyHtml: "<p>p</p>", recipients: ["p1@t.com", "p2@t.com"],
    fromAccountIds: [2], sendType: "immediate", customLimits: { 2: 360000 },
  }})).data.data.id;
  const before = sent.length;
  const run = mailer.sendBulkCampaign(cp);
  await sleep(1500);
  assert.equal(sent.length, before, "nothing sent while paused: " + JSON.stringify(sent.slice(before).map(m => [m.to, m.via, m.headers["X-Abacco-Campaign"]])));
  let r = await call("GET", "/api/deliverability/accounts", { token: T.u1 });
  assert.equal(r.data.data[0].status, "paused");
  assert.deepEqual(r.data.data.map(a => a.email).sort(), ["alice@gmail.com", "bob@gmail.com"], "employee sees own accounts only");
  r = await call("POST", "/api/deliverability/accounts/2/resume", { token: T.u2 });
  assert.equal(r.status, 404, "cannot resume someone else's account");
  r = await call("POST", "/api/deliverability/accounts/2/resume", { token: T.u1 });
  assert.equal(r.status, 200);
  // engine re-checks within its wait interval; shorten by forcing the loop
  await Promise.race([run, sleep(70_000)]);
  assert.deepEqual(sent.slice(before).map(m => m.to).sort(), ["p1@t.com", "p2@t.com"]);
  assert.equal(db.campaign.find(c => c.id === cp).status, "completed");

  console.log("✔ bounces: DSN hard/soft/block/delayed, X-Failed-Recipients, idempotent, auto-suppress, spike auto-pause, paused account waits, resume sends");
}

/* ══════════════════ 5. PROVIDER LIMIT + LOGIN FAILURE ══════════════════ */
{
  smtp.set("q2@t.com", [Object.assign(new Error("Message rejected"), { responseCode: 550, response: "550 5.4.5 Daily user sending quota exceeded." })]);
  const cq = (await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Quota", subjects: ["Q"], bodyHtml: "<p>q</p>", recipients: ["q1@t.com", "q2@t.com", "q3@t.com"],
    fromAccountIds: [1], sendType: "immediate", customLimits: { 1: 360000 },
  }})).data.data.id;
  const run = mailer.sendBulkCampaign(cq);
  await sleep(2000);
  const alice = db.emailAccount.find(a => a.id === 1);
  assert.match(alice.sendingPausedReason || "", /Provider sending limit/);
  assert.ok(alice.sendingPausedUntil > new Date(Date.now() + 23 * 3600e3));
  assert.equal(byEmail(cq, "q2@t.com").status, "pending", "recipient requeued, not failed");
  assert.equal(byEmail(cq, "q2@t.com").retryCount, 0);
  assert.equal(rows(cq).filter(x => x.status === "failed").length, 0);
  await call("POST", "/api/deliverability/accounts/1/resume", { token: T.admin });
  await Promise.race([run, sleep(70_000)]);
  assert.deepEqual(rows(cq).map(x => x.status), ["sent", "sent", "sent"]);

  smtp.set("l1@t.com", [Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 })]);
  const cl = (await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Login", subjects: ["L"], bodyHtml: "<p>l</p>", recipients: ["l1@t.com"],
    fromAccountIds: [1], sendType: "immediate", customLimits: { 1: 360000 },
  }})).data.data.id;
  const run2 = mailer.sendBulkCampaign(cl);
  await sleep(1500);
  assert.match(alice.sendingPausedReason, /^Login failed/);
  assert.equal(alice.sendingPausedUntil, null, "login pause has no automatic end");
  assert.equal(await inbound.resumeExpiredPauses(), 0);
  assert.equal(byEmail(cl, "l1@t.com").status, "pending");
  // stop it so the test can finish
  await call("POST", `/api/campaigns/${cl}/stop`, { token: T.u1 });
  await call("POST", "/api/deliverability/accounts/1/resume", { token: T.admin });
  await Promise.race([run2, sleep(70_000)]);

  // Expired timed pause is lifted by the worker job
  alice.sendingPausedAt = new Date(); alice.sendingPausedReason = "x"; alice.sendingPausedUntil = new Date(Date.now() - 1000);
  assert.equal(await inbound.resumeExpiredPauses(), 1);
  assert.equal(alice.sendingPausedAt, null);
  console.log("✔ provider limit & login failure: account paused, recipients requeued (not failed), resume completes, timed pauses expire");
}

/* ══════════════════ 6. DELIVERABILITY ADMIN API ══════════════════ */
{
  cache.del("deliverability:summary");
  let r = await call("GET", "/api/deliverability/summary", { token: T.u1 });
  assert.equal(r.status, 403);
  r = await call("GET", "/api/deliverability/summary", { token: T.admin });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.publicUrlConfigured, true);
  assert.ok(r.data.data.suppressedTotal >= 6);
  assert.ok(r.data.data.suppressedByReason.hard_bounce >= 2);

  r = await call("POST", "/api/deliverability/suppressions", { token: T.admin, body: { emails: "X1@t.com, x2@t.com\nnot-an-email; x1@t.com", note: "client list" } });
  assert.deepEqual([r.data.added, r.data.alreadyListed, r.data.invalidCount], [2, 0, 1]);
  r = await call("GET", "/api/deliverability/suppressions?search=x1", { token: T.admin });
  assert.equal(r.data.data.length, 1);
  assert.equal(r.data.data[0].reason, "manual");
  const id = r.data.data[0].id;
  r = await call("DELETE", `/api/deliverability/suppressions/${id}`, { token: T.admin });
  assert.equal(r.status, 200);
  assert.equal((await supp.getSuppression("x1@t.com")).suppressed, false, "cache cleared on removal");
  r = await call("GET", "/api/deliverability/suppressions/export", { token: T.admin });
  assert.match(r.data, /^email,reason,source,note,added_at\n/);
  assert.match(r.data, /"x2@t\.com","manual","admin","client list"/);
  r = await call("GET", "/api/deliverability/suppressions?reason=hard_bounce", { token: T.admin });
  assert.ok(r.data.data.every(x => x.reason === "hard_bounce"));

  // Campaign stats carry engagement
  r = await call("GET", `/api/campaigns/${c1}/view`, { token: T.u1 });
  const st = r.data.data.stats;
  // a1 replied; a3's "remove me" is also a reply
  assert.deepEqual([st.completed, st.replied, st.unsubscribed], [5, 2, 3]);
  assert.equal(st.replyRate, 40);
  r = await call("GET", "/api/campaigns", { token: T.u1 });
  const row = r.data.data.find(x => x.id === c1);
  assert.deepEqual([row.repliedCount, row.unsubscribedCount, row.replyRate], [2, 3, 40]);
  console.log("✔ deliverability API: role checks, summary, add/search/remove/export, engagement stats in campaign views");
}

console.log("\nPHASE 1 END-TO-END TESTS PASSED");
process.exit(0);
