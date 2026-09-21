// Phase 3 end-to-end test: reply classification (rules + AI fallback),
// reply automation, replies API, settings, merge fields, follow-up sequences.
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "phase3-secret";
process.env.PORT = "5079";
process.env.MAILBOX_ENCRYPTION_KEY = "e".repeat(64);
process.env.FEATURE_AI_REPLY_CLASSIFICATION = "true";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.DAILY_LOG_FLUSH_MS = "50";

// Stub the Anthropic API; everything else goes to the real fetch.
const realFetch = globalThis.fetch;
let aiMode = "ok";
let aiAnswer = "meeting";
let aiCalls = 0;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.anthropic.com/")) {
    aiCalls++;
    const body = JSON.parse(opts.body);
    assert.equal(opts.headers["x-api-key"], "test-key");
    assert.match(body.messages[0].content, /<reply>/);
    if (aiMode === "fail") return new Response("boom", { status: 500 });
    if (aiMode === "garbage") return new Response(JSON.stringify({ content: [{ type: "text", text: '{"category":"spam"}' }] }), { status: 200 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: '```json\n{"category":"' + aiAnswer + '","confidence":0.91}\n```' }] }), { status: 200 });
  }
  return realFetch(url, opts);
};

const S = new URL("../src", import.meta.url).pathname;
await import("@prisma/client");
await import("nodemailer");
const db = globalThis.__db;
const sent = globalThis.__sent;
const jwt = (await import("jsonwebtoken")).default;
const mp = await import("mailparser");
const simpleParser = mp.simpleParser || mp.default.simpleParser;

db.user.push(
  { id: "admin", name: "Admin", email: "admin@x.com", jobRole: "Admin", isActive: true, password: "x" },
  { id: "u1", name: "Pawan", email: "pawan@x.com", jobRole: "Employee", isActive: true, password: "x" },
  { id: "u2", name: "Priya", email: "priya@x.com", jobRole: "Employee", isActive: true, password: "x" },
);
const acct = (id, userId, email) => ({ id, userId, email, smtpHost: "localhost", smtpPort: 465, smtpUser: email, encryptedPass: "pw",
  provider: "gmail", senderName: email.split("@")[0], deleted: false, verified: true, sendingPausedAt: null, sendingPausedUntil: null });
db.emailAccount.push(acct(1, "u1", "alice@gmail.com"), acct(2, "u1", "bob@gmail.com"), acct(3, "u2", "carol@gmail.com"));

await import(`${new URL("../server.js", import.meta.url).pathname}`);
const classifier = await import(`${S}/services/replyClassifier.service.js`);
const automation = await import(`${S}/services/automation.service.js`);
const inbound = await import(`${S}/services/inboundProcessor.service.js`);
const mailer = await import(`${S}/services/campaignMailer.service.js`);
const crm = await import(`${S}/services/crm.service.js`);
const { runFollowupCleanup } = await import(`${S}/controllers/campaigns.controller.js`);

const API = "http://localhost:5079";
const tok = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1h" });
const T = { admin: tok("admin"), u1: tok("u1"), u2: tok("u2") };
async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await realFetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DAY = 86400e3;
await sleep(300);

/* ══════════════════ 1. CLASSIFIER ══════════════════ */
{
  const R = (text, subject = "") => classifier.classifyByRules({ subject, text }).category;
  assert.equal(R("Yes please, send me the pricing and the attendee list."), "interested");
  assert.equal(R("We are not interested at this time, thanks."), "not_interested", "'not interested' beats 'interested'");
  assert.equal(R("Can we schedule a call on Thursday?"), "meeting");
  assert.equal(R("Is this list GDPR compliant?"), "question");
  assert.equal(R("She has left the company, please contact my colleague Tom."), "wrong_person");
  assert.equal(R("Please remove me from your list"), "unsubscribe");
  assert.equal(R("", "unsubscribe"), "unsubscribe");
  assert.equal(R("Ok."), "other");

  // AI only for unsure results; failures fall back to rules
  aiCalls = 0;
  let r = await classifier.classifyReply({ subject: "Re: x", text: "Please remove me" });
  assert.deepEqual([r.category, r.source, aiCalls], ["unsubscribe", "rules", 0], "confident rule skips AI");
  r = await classifier.classifyReply({ subject: "Re: x", text: "Hmm, maybe. Tuesday?" });
  assert.deepEqual([r.category, r.source, r.confidence, aiCalls], ["meeting", "ai", 0.91, 1]);
  aiMode = "fail";
  r = await classifier.classifyReply({ subject: "Re: x", text: "What is this about?" });
  assert.deepEqual([r.category, r.source], ["question", "rules"]);
  aiMode = "garbage";
  r = await classifier.classifyReply({ subject: "Re: x", text: "Ok." });
  assert.deepEqual([r.category, r.source], ["other", "rules"], "unknown AI category rejected");
  aiMode = "ok";
  console.log("✔ classifier: rules for all 7 categories, AI only when unsure, AI errors/garbage fall back to rules");
}

/* ══════════════════ 2. MERGE FIELDS ══════════════════ */
{
  const vars = { firstName: "Ann <b>", company: null, email: "a@x.com" };
  assert.equal(automation.renderMergeFields("Hi {{firstName}}, {{ company | your team }}! {{unknown}}", vars),
    "Hi Ann &lt;b&gt;, your team! {{unknown}}");
  assert.equal(automation.renderMergeFields("Hi {{firstName}}", vars, { html: false }), "Hi Ann <b>");
  assert.equal(automation.hasMergeFields("plain text"), false);
  console.log("✔ merge fields: values escaped, fallbacks, unknown tags untouched");
}

/* ══════════════════ helpers ══════════════════ */
function rawReply({ from, to, subject = "Re: Expo", inReplyTo, body, id }) {
  return Buffer.from([
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${id}>`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain", "", body,
  ].join("\r\n"));
}
async function deliver(accountId, raw) {
  const parsed = await simpleParser(raw);
  const account = { ...db.emailAccount.find(a => a.id === accountId) };
  return inbound.processInboundMessage({ account, parsed, messageId: parsed.messageId, conversationId: `cv-${parsed.messageId}`, receivedAt: new Date(), rawSource: raw });
}
const stages = await crm.listStages();
const stage = (n) => stages.find(s => s.name === n);

/* ══════════════════ 3. CAMPAIGN WITH MERGE FIELDS ══════════════════ */
let c1;
{
  // Contacts with names (Ann has a company; Ben has none)
  await crm.ensureContact({ email: "ann@acme.io", ownerId: "u1", name: "Ann Lee", source: "manual" });
  await crm.ensureContact({ email: "ben@gmail.com", ownerId: "u1", name: "Ben", source: "manual" });
  const r = await call("POST", "/api/campaigns", { token: T.u1, body: {
    campaignName: "Expo", subjects: ["Expo passes for {{company|you}}"],
    bodyHtml: "<p>Hi {{firstName|there}},</p><p>Passes for {{company|your team}}.</p>",
    recipients: ["ann@acme.io", "ben@gmail.com", "cara@corp.com", "dan@corp.com", "eve@corp.com", "fay@corp.com"],
    fromAccountIds: [1, 2], sendType: "immediate", customLimits: { 1: 360000, 2: 360000 },
  }});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c1 = r.data.data.id;
  await mailer.sendBulkCampaign(c1);
  const annMail = sent.find(m => m.to === "ann@acme.io");
  assert.equal(annMail.subject, "acme - Expo passes for Acme");
  assert.match(annMail.html, /Hi Ann,/);
  assert.match(annMail.html, /Passes for Acme\./);
  const benMail = sent.find(m => m.to === "ben@gmail.com");
  assert.match(benMail.html, /Hi Ben,/);
  assert.match(benMail.html, /Passes for your team\./);
  const caraMail = sent.find(m => m.to === "cara@corp.com");
  assert.match(caraMail.html, /Hi there,/, "no contact → fallback");
  assert.equal(db.campaignRecipient.find(x => x.campaignId === c1 && x.email === "ann@acme.io").sentSubject, "Expo passes for Acme", "personalised subject stored");
  console.log("✔ engine personalises subject + body per recipient and stores the personalised subject");
}
const rec = (email, cid = c1) => db.campaignRecipient.find(x => x.campaignId === cid && x.email === email);
const mailTo = (email, cid = c1) => sent.find(m => m.to === email && m.headers["X-Abacco-Campaign"]?.startsWith(`${cid}-`));

/* ══════════════════ 4. REPLY AUTOMATION ══════════════════ */
{
  // Ann has a deal in New → interested reply moves it forward + task + notification
  const ann = db.contact.find(c => c.email === "ann@acme.io");
  const { deal } = await crm.ensureDealForContact({ contact: ann, ownerId: "u1", externalKey: "t:ann", stageName: "New" });
  aiAnswer = "interested"; // rule says interested at 0.75 → AI is consulted and agrees
  let out = await deliver(rec("ann@acme.io").accountId, rawReply({
    from: "ann@acme.io", to: "x", inReplyTo: mailTo("ann@acme.io").messageId, id: "r-ann@acme.io",
    body: "Sounds great, please send the details.\n\nOn Mon, Alice wrote:\n> not interested? unsubscribe",
  }));
  assert.equal(out.detail.category, "interested");
  let d = db.deal.find(x => x.id === deal.id);
  assert.equal(d.stageId, stage("Interested").id);
  assert.ok(db.activity.some(a => a.dealId === deal.id && /New → Interested \(automatic — interested reply\)/.test(a.title)));
  const annEvent = db.replyEvent.find(e => e.email === "ann@acme.io");
  assert.deepEqual([annEvent.category, annEvent.categorySource], ["interested", "ai"]);
  aiAnswer = "meeting";
  const task = db.task.find(t => t.externalKey === `reply:${annEvent.id}`);
  assert.ok(task);
  assert.deepEqual([task.assignedToId, task.priority, task.dealId], ["u1", "high", deal.id]);
  assert.ok(Math.abs(new Date(task.dueAt) - (Date.now() + 4 * 3600e3)) < 60_000, "due in 4h");
  assert.ok(db.notification.some(n => n.userId === "u1" && n.type === "reply_received" && n.link === `/crm/replies?open=${annEvent.id}`));

  // question later must NOT pull the deal back to Replied
  await automation.applyReplyAutomation({ replyEvent: { ...annEvent, id: 99999, category: "question" }, contact: ann });
  d = db.deal.find(x => x.id === deal.id);
  assert.equal(d.stageId, stage("Interested").id, "forward only");
  // idempotent: same event again → no second task
  await automation.applyReplyAutomation({ replyEvent: annEvent, contact: ann });
  assert.equal(db.task.filter(t => t.externalKey === `reply:${annEvent.id}`).length, 1);

  // Won deals never move
  db.deal.find(x => x.id === deal.id).stageId = stage("Won").id;
  db.deal.find(x => x.id === deal.id).status = "won";
  await automation.applyReplyAutomation({ replyEvent: { ...annEvent, id: 99998, category: "meeting" }, contact: ann });
  assert.equal(db.deal.find(x => x.id === deal.id).stageId, stage("Won").id);

  // Reply from someone with no deal → deal created (new contact from the reply)
  out = await deliver(rec("cara@corp.com").accountId, rawReply({
    from: "Cara Corp <cara@corp.com>", to: "x", inReplyTo: mailTo("cara@corp.com").messageId, id: "r-cara@corp.com",
    body: "What sizes do the booths come in?",
  }));
  assert.equal(out.detail.category, "meeting", "unsure rule result → AI stub says meeting");
  const cara = db.contact.find(c => c.email === "cara@corp.com");
  const caraDeal = db.deal.find(x => x.contactId === cara.id);
  assert.equal(caraDeal.stageId, stage("Interested").id);
  assert.equal(caraDeal.source, "reply");
  assert.equal(db.replyEvent.find(e => e.email === "cara@corp.com").categorySource, "ai");

  // Not interested → no deal created, owner notified, no task
  out = await deliver(rec("dan@corp.com").accountId, rawReply({
    from: "dan@corp.com", to: "x", inReplyTo: mailTo("dan@corp.com").messageId, id: "r-dan@corp.com",
    body: "No thanks, not interested.",
  }));
  assert.equal(out.detail.category, "not_interested");
  const dan = db.contact.find(c => c.email === "dan@corp.com");
  assert.equal(db.deal.some(x => x.contactId === dan.id), false);
  const danEvent = db.replyEvent.find(e => e.email === "dan@corp.com");
  assert.equal(db.task.some(t => t.externalKey === `reply:${danEvent.id}`), false);

  // automation off → nothing happens
  await automation.saveSetting("replyAutomation", { ...automation.DEFAULT_REPLY_AUTOMATION, enabled: false }, "admin");
  const before = db.task.length;
  await automation.applyReplyAutomation({ replyEvent: { ...danEvent, id: 99997, category: "interested" }, contact: dan });
  assert.equal(db.task.length, before);
  await automation.saveSetting("replyAutomation", automation.DEFAULT_REPLY_AUTOMATION, "admin");
  console.log("✔ reply automation: forward-only stage moves, won deals untouched, tasks once, notify, deal created for positive replies only, on/off switch");
}

/* ══════════════════ 5. REPLIES API + SETTINGS ══════════════════ */
{
  let r = await call("GET", "/api/crm/replies", { token: T.u1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.length, 3);
  assert.deepEqual(r.data.counts, { interested: 1, meeting: 1, not_interested: 1 });
  const danRow = r.data.data.find(x => x.email === "dan@corp.com");
  assert.equal(danRow.contact.displayName, "dan@corp.com");
  assert.equal(danRow.campaign.name, "Expo");
  assert.equal(r.data.canViewAll, false);

  r = await call("GET", "/api/crm/replies", { token: T.u2 });
  assert.equal(r.data.data.length, 0, "other user's mailbox replies hidden");
  r = await call("GET", "/api/crm/replies?scope=all", { token: T.u2 });
  assert.equal(r.data.data.length, 0, "scope=all ignored for employees");
  r = await call("GET", "/api/crm/replies?scope=all&category=interested", { token: T.admin });
  assert.deepEqual(r.data.data.map(x => x.email), ["ann@acme.io"]);
  r = await call("PATCH", `/api/crm/replies/${danRow.id}`, { token: T.u2, body: { handled: true } });
  assert.equal(r.status, 404);

  // reclassify Dan → interested: deal created + task, marked manual
  r = await call("PATCH", `/api/crm/replies/${danRow.id}`, { token: T.u1, body: { category: "interested" } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.data.category, r.data.data.categorySource], ["interested", "manual"]);
  assert.ok(r.data.automation.taskId);
  const dan = db.contact.find(c => c.email === "dan@corp.com");
  assert.equal(db.deal.find(x => x.contactId === dan.id).stageId, stage("Interested").id);
  r = await call("PATCH", `/api/crm/replies/${danRow.id}`, { token: T.u1, body: { category: "spam" } });
  assert.equal(r.status, 400);

  // handled → leaves "to do"
  r = await call("PATCH", `/api/crm/replies/${danRow.id}`, { token: T.u1, body: { handled: true } });
  assert.ok(r.data.data.handledAt);
  r = await call("GET", "/api/crm/replies", { token: T.u1 });
  assert.equal(r.data.data.some(x => x.id === danRow.id), false);
  r = await call("GET", "/api/crm/replies?status=handled", { token: T.u1 });
  assert.equal(r.data.data[0].handledBy.name, "Pawan");

  // settings
  r = await call("GET", "/api/crm/settings/reply-automation", { token: T.u1 });
  assert.equal(r.data.canEdit, false);
  assert.equal(r.data.aiEnabled, true);
  assert.equal(r.data.data.rules.interested.stageName, "Interested");
  const body = structuredClone(r.data.data);
  body.rules.not_interested.markLost = true;
  r = await call("PUT", "/api/crm/settings/reply-automation", { token: T.u1, body });
  assert.equal(r.status, 403);
  const bad = structuredClone(body);
  bad.rules.question.taskDueHours = -1;
  r = await call("PUT", "/api/crm/settings/reply-automation", { token: T.admin, body: bad });
  assert.equal(r.status, 400);
  const clash = structuredClone(body);
  clash.rules.not_interested.stageName = "Replied";
  r = await call("PUT", "/api/crm/settings/reply-automation", { token: T.admin, body: clash });
  assert.equal(r.status, 400, "stage + mark lost can't both be set");
  const missing = structuredClone(body);
  missing.rules.question.stageId = 424242;
  r = await call("PUT", "/api/crm/settings/reply-automation", { token: T.admin, body: missing });
  assert.equal(r.status, 400);
  r = await call("PUT", "/api/crm/settings/reply-automation", { token: T.admin, body });
  assert.equal(r.status, 200);

  // mark-lost rule now applies: Ann's colleague? use Dan's open deal via a new not_interested reply
  const danDeal = db.deal.find(x => x.contactId === dan.id);
  await automation.applyReplyAutomation({ replyEvent: { id: 88888, email: dan.email, category: "not_interested", snippet: "no" }, contact: dan });
  const lostDeal = db.deal.find(x => x.id === danDeal.id);
  assert.deepEqual([lostDeal.status, lostDeal.lostReason], ["lost", "Replied: Not interested"]);
  console.log("✔ replies API: own mailboxes only (admin all), counts, reclassify runs automation, handled/reopen; settings validation + mark-lost rule");
}

/* ══════════════════ 6. FOLLOW-UP SEQUENCES ══════════════════ */
{
  let r = await call("GET", "/api/automation/sequences/candidates", { token: T.u1 });
  assert.deepEqual(r.data.data.map(c => c.id), [c1]);
  r = await call("GET", "/api/automation/sequences/candidates", { token: T.u2 });
  assert.deepEqual(r.data.data, [], "only own campaigns");

  r = await call("POST", "/api/automation/sequences", { token: T.u2, body: { campaignId: c1, steps: [{ delayDays: 3, bodyHtml: "<p>x</p>" }] } });
  assert.equal(r.status, 403);
  r = await call("POST", "/api/automation/sequences", { token: T.u1, body: { campaignId: c1, steps: [] } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/automation/sequences", { token: T.u1, body: { campaignId: c1, steps: [{ delayDays: 0, bodyHtml: "<p>x</p>" }] } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/automation/sequences", { token: T.u1, body: { campaignId: c1, steps: [{ delayDays: 3, bodyHtml: "<p> </p>" }] } });
  assert.equal(r.status, 400, "empty body");
  r = await call("POST", "/api/automation/sequences", { token: T.u1, body: {
    campaignId: c1, name: "Expo nudges",
    steps: [
      { delayDays: 3, bodyHtml: "<p>Hi {{firstName|there}}, bumping this up.</p>" },
      { delayDays: 4, bodyHtml: "<p>Last note, {{firstName|friend}}.</p>" },
    ],
  }});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const seqId = r.data.data.id;
  assert.equal(r.data.data.status, "draft");
  r = await call("POST", "/api/automation/sequences", { token: T.u1, body: { campaignId: c1, steps: [{ delayDays: 3, bodyHtml: "<p>x</p>" }] } });
  assert.equal(r.status, 409);
  r = await call("GET", "/api/automation/sequences/candidates", { token: T.u1 });
  assert.deepEqual(r.data.data, [], "campaign with a sequence is no longer a candidate");

  // draft does nothing
  assert.deepEqual(await automation.runSequences(), []);
  assert.equal(db.sequenceEnrollment.length, 0);

  // Make the original sends 4 days old; bob's recipients are "busy"
  for (const x of db.campaignRecipient.filter(x => x.campaignId === c1)) x.sentAt = new Date(Date.now() - 4 * DAY);
  // fay: sent only 1 day ago → not due yet
  rec("fay@corp.com").sentAt = new Date(Date.now() - 1 * DAY);
  // eve: on the do-not-contact list
  db.suppressedEmail.push({ id: 7001, email: "eve@corp.com", reason: "unsubscribe", createdAt: new Date() });
  // ben: hard bounced
  rec("ben@gmail.com").bounceType = "hard";

  r = await call("POST", `/api/automation/sequences/${seqId}/activate`, { token: T.u2 });
  assert.equal(r.status, 403);
  r = await call("POST", `/api/automation/sequences/${seqId}/activate`, { token: T.u1 });
  assert.equal(r.status, 200);

  // A campaign still sending from one of the mailboxes makes it busy
  const busyAccount = rec("fay@corp.com").accountId;
  const otherAccount = busyAccount === 1 ? 2 : 1;
  db.campaign.push({ id: 9100, userId: "u1", name: "Busy", status: "sending", sendType: "immediate" });
  db.campaignRecipient.push({ id: 9101, campaignId: 9100, email: "zz@z.io", status: "pending", accountId: busyAccount, retryCount: 0 });

  let queued = await automation.runSequences();
  const E = (email) => db.sequenceEnrollment.find(e => e.sequenceId === seqId && e.email === email);
  assert.equal(db.sequenceEnrollment.length, 6, "everyone sent is enrolled");
  assert.equal(E("ann@acme.io").status, "replied");
  assert.equal(E("cara@corp.com").status, "replied");
  assert.equal(E("dan@corp.com").status, "replied");
  assert.equal(E("ben@gmail.com").status, "bounced");
  assert.equal(E("eve@corp.com").status, "unsubscribed");
  assert.equal(E("fay@corp.com").status, "active");
  assert.ok(E("fay@corp.com").nextDueAt > new Date(), "fay not due yet");
  assert.deepEqual(queued, [], "nobody due & free yet (fay not due)");

  // make fay due; her mailbox is busy → deferred
  E("fay@corp.com").nextDueAt = new Date(Date.now() - 1000);
  queued = await automation.runSequences();
  assert.deepEqual(queued, [], "busy mailbox deferred");
  db.campaign.find(c => c.id === 9100).status = "completed";

  queued = await automation.runSequences();
  assert.equal(queued.length, 1);
  assert.deepEqual([queued[0].step, queued[0].count], [1, 1]);
  const stepCampaign = db.campaign.find(c => c.id === queued[0].campaignId);
  assert.deepEqual([stepCampaign.sendType, stepCampaign.status, stepCampaign.parentCampaignId, stepCampaign.sequenceId, stepCampaign.sequenceStep],
    ["followup", "sending", c1, seqId, 1]);
  assert.equal(E("fay@corp.com").stepsSent, 1);
  assert.equal(E("fay@corp.com").lastCampaignId, stepCampaign.id);
  assert.ok(Math.abs(E("fay@corp.com").nextDueAt - (Date.now() + 4 * DAY)) < 60_000, "next step in 4 days");
  assert.deepEqual(await automation.runSequences(), [], "nothing queued twice");

  // the worker sends it: threaded, personalised, from the original mailbox
  stepCampaign.customLimits = JSON.stringify({ 1: 360000, 2: 360000 });
  await mailer.sendBulkCampaign(stepCampaign.id);
  const fu = sent.find(m => m.to === "fay@corp.com" && m.headers["X-Abacco-Campaign"]?.startsWith(`${stepCampaign.id}-`));
  assert.ok(fu, "step 1 sent");
  assert.match(fu.html, /Hi there, bumping this up\./);
  assert.equal(fu.headers["In-Reply-To"], mailTo("fay@corp.com").messageId);
  assert.equal(fu.subject, `Re: ${rec("fay@corp.com").sentSubject}`);
  assert.equal(fu.via, db.emailAccount.find(a => a.id === rec("fay@corp.com").accountId).email);

  // step 2 when due → completed
  E("fay@corp.com").nextDueAt = new Date(Date.now() - 1000);
  queued = await automation.runSequences();
  assert.deepEqual([queued[0].step, queued[0].count], [2, 1]);
  assert.deepEqual([E("fay@corp.com").status, E("fay@corp.com").nextDueAt, E("fay@corp.com").stepsSent], ["completed", null, 2]);

  // stats + detail + people list
  r = await call("GET", `/api/automation/sequences/${seqId}`, { token: T.u2 });
  assert.equal(r.status, 200, "sequences are visible to everyone");
  assert.equal(r.data.data.canEdit, false);
  assert.deepEqual(r.data.data.stats.people, { replied: 3, bounced: 1, unsubscribed: 1, completed: 1 });
  assert.equal(r.data.data.stats.steps[1].sent, 1);
  assert.equal(r.data.data.stats.steps[2].queued, 1);
  assert.equal(r.data.data.baseSent, 6);
  r = await call("GET", `/api/automation/sequences/${seqId}/enrollments?status=replied`, { token: T.u1 });
  assert.equal(r.data.pagination.total, 3);
  r = await call("GET", "/api/automation/sequences", { token: T.u1 });
  assert.equal(r.data.data[0].stepCount, 2);
  assert.ok(r.data.mergeFields.includes("firstName"));
  r = await call("GET", "/api/automation/sequences", { token: T.u2 });
  assert.equal(r.data.data.length, 0, "employees list their own sequences");

  // editing: can't drop below steps already sent; adding a step re-activates finished people
  r = await call("PUT", `/api/automation/sequences/${seqId}`, { token: T.u1, body: { steps: [{ delayDays: 3, bodyHtml: "<p>only one</p>" }] } });
  assert.equal(r.status, 400);
  r = await call("PUT", `/api/automation/sequences/${seqId}`, { token: T.u1, body: { steps: [
    { delayDays: 3, bodyHtml: "<p>a</p>" }, { delayDays: 4, bodyHtml: "<p>b</p>" }, { delayDays: 5, bodyHtml: "<p>c</p>" },
  ] } });
  assert.equal(r.status, 200);
  assert.equal(E("fay@corp.com").status, "active");
  assert.ok(Math.abs(E("fay@corp.com").nextDueAt - (Date.now() + 5 * DAY)) < 60_000, "waits step 3's delay");

  // fay replies later → stopped even though her step-2 email is queued
  db.replyEvent.push({ id: 7777, email: "fay@corp.com", accountId: 1, messageId: "<fr>", intent: "reply", matchedBy: "address", receivedAt: new Date(), category: "other" });
  await automation.runSequences();
  assert.equal(E("fay@corp.com").status, "replied");

  // pause / archive / per-person stop
  const extra = db.campaignRecipient.length;
  db.campaignRecipient.push({ id: 9200, campaignId: c1, email: "gus@corp.com", status: "sent", accountId: 1, sentAt: new Date(Date.now() - 10 * DAY), sentSubject: "Expo", retryCount: 0 });
  r = await call("POST", `/api/automation/sequences/${seqId}/pause`, { token: T.u1 });
  assert.deepEqual(await automation.runSequences(), [], "paused sequences don't run");
  assert.equal(E("gus@corp.com"), undefined);
  await call("POST", `/api/automation/sequences/${seqId}/activate`, { token: T.admin });
  db.campaign.forEach(c => { if (c.sequenceId === seqId) c.status = "completed"; });
  queued = await automation.runSequences();
  assert.equal(E("gus@corp.com").stepsSent, 1, "new sent recipient enrolled and due immediately");
  r = await call("POST", `/api/automation/enrollments/${E("gus@corp.com").id}/stop`, { token: T.u2 });
  assert.equal(r.status, 403);
  r = await call("POST", `/api/automation/enrollments/${E("gus@corp.com").id}/stop`, { token: T.u1 });
  assert.equal(E("gus@corp.com").status, "stopped");
  r = await call("POST", `/api/automation/sequences/${seqId}/archive`, { token: T.u1 });
  assert.equal(r.status, 200);
  r = await call("POST", `/api/automation/sequences/${seqId}/activate`, { token: T.u1 });
  assert.equal(r.status, 400, "archived can't be re-activated");
  r = await call("GET", "/api/automation/sequences?status=archived", { token: T.u1 });
  assert.equal(r.data.data.length, 1);

  // cleanup job keeps sequence campaigns
  db.campaign.forEach(c => { if (c.sequenceId === seqId) c.createdAt = new Date(Date.now() - 5 * DAY); });
  for (let i = 0; i < 4; i++) db.campaign.push({ id: 9300 + i, userId: "u1", name: `old${i}`, sendType: "followup", status: "completed", parentCampaignId: c1, createdAt: new Date(Date.now() - 5 * DAY), sequenceId: null });
  const seqCampaigns = db.campaign.filter(c => c.sequenceId === seqId).length;
  await runFollowupCleanup();
  assert.equal(db.campaign.filter(c => c.sequenceId === seqId).length, seqCampaigns, "sequence steps kept");
  assert.equal(db.campaign.filter(c => c.id >= 9300 && c.id < 9304).length, 0, "manual old follow-ups still cleaned");
  console.log("✔ sequences: validation, ownership, enroll on activation, stop replied/bounced/unsubscribed, not-due & busy deferral, threaded personalised steps, no double-queue, completion, edits, pause/archive/stop, stats, cleanup-safe");
}

console.log("\nPHASE 3 END-TO-END TESTS PASSED");
process.exit(0);
