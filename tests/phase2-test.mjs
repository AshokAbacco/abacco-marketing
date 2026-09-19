// Phase 2 end-to-end test: CRM API + integrations (leads, replies, user
// deletion, reminders, migration script) against the in-memory DB mock.
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "phase2-secret";
process.env.PORT = "5078";
process.env.MAILBOX_ENCRYPTION_KEY = "d".repeat(64);

const S = new URL("../src", import.meta.url).pathname;
await import("@prisma/client");
await import("nodemailer");
const db = globalThis.__db;
const jwt = (await import("jsonwebtoken")).default;
const mp = await import("mailparser");
const simpleParser = mp.simpleParser || mp.default.simpleParser;

db.user.push(
  { id: "admin", name: "Admin Boss", email: "admin@x.com", jobRole: "Admin", isActive: true, password: "x" },
  { id: "u1", name: "Pawan", email: "pawan@x.com", jobRole: "Employee", isActive: true, password: "x" },
  { id: "u2", name: "Priya", email: "priya@x.com", jobRole: "Employee", isActive: true, password: "x" },
  { id: "gone", name: "Leaver", email: "leaver@x.com", jobRole: "Employee", isActive: true, password: "x" },
);
db.emailAccount.push({ id: 1, userId: "u1", email: "alice@gmail.com", deleted: false, verified: true });

await import(`${new URL("../server.js", import.meta.url).pathname}`);
const inbound = await import(`${S}/services/inboundProcessor.service.js`);
const tasksCtrl = await import(`${S}/controllers/crm/tasks.controller.js`);

const API = "http://localhost:5078";
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

/* ══════════════════ 1. STAGES ══════════════════ */
let stages;
{
  let r = await call("GET", "/api/crm/stages", { token: T.u1 });
  assert.equal(r.status, 200);
  stages = r.data.data;
  assert.deepEqual(stages.map(s => s.name), ["New", "Contacted", "Replied", "Interested", "Proposal Sent", "Won", "Lost"]);
  assert.equal(stages.filter(s => s.isDefault).map(s => s.name)[0], "New");
  assert.equal(r.data.canManage, false);
  // concurrent first calls must not duplicate
  await Promise.all([call("GET", "/api/crm/stages", { token: T.u2 }), call("GET", "/api/crm/stages", { token: T.admin })]);
  assert.equal(db.pipelineStage.length, 7);

  r = await call("POST", "/api/crm/stages", { token: T.u1, body: { name: "Negotiation" } });
  assert.equal(r.status, 403);
  r = await call("POST", "/api/crm/stages", { token: T.admin, body: { name: "negotiation", color: "#123456", probability: 70 } });
  assert.equal(r.status, 201);
  const nego = r.data.data;
  r = await call("POST", "/api/crm/stages", { token: T.admin, body: { name: "Negotiation" } });
  assert.equal(r.status, 409, "duplicate stage name");
  r = await call("PUT", `/api/crm/stages/${nego.id}`, { token: T.admin, body: { name: "Negotiation", color: "bad" } });
  assert.equal(r.status, 400);
  // move Negotiation before Won
  const ids = stages.map(s => s.id);
  ids.splice(5, 0, nego.id);
  r = await call("PUT", "/api/crm/stages/reorder", { token: T.admin, body: { ids } });
  assert.equal(r.status, 200);
  r = await call("PUT", "/api/crm/stages/reorder", { token: T.admin, body: { ids: ids.slice(1) } });
  assert.equal(r.status, 400, "reorder must list every stage");
  r = await call("GET", "/api/crm/stages", { token: T.u1 });
  stages = r.data.data;
  assert.deepEqual(stages.map(s => s.name).slice(4, 7), ["Proposal Sent", "negotiation", "Won"]);
  r = await call("PUT", `/api/crm/stages/${stages[0].id}`, { token: T.admin, body: { isDefault: false } });
  assert.equal(r.status, 400, "can't unset the only default");
  console.log("✔ stages: defaults created once, admin-only changes, rename/reorder/validation");
}
const stage = (name) => stages.find(s => s.name.toLowerCase() === name.toLowerCase());

/* ══════════════════ 2. LEADS → CRM ══════════════════ */
let acmeContactId, acmeCompanyId;
{
  let r = await call("POST", "/api/leads/create-from-inbox", { token: T.u1, body: {
    email: "info@acme-expo.com", fromEmail: "John.Doe@Acme-Expo.com", fromName: "John Doe",
    subject: "Booth enquiry", leadType: "ATTENDEES", phone: "+1 555", country: "USA",
    website: "https://www.acme-expo.com/about", conversationId: "c1",
  }});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.contactId);
  acmeContactId = r.data.contactId;
  const contact = db.contact.find(c => c.id === acmeContactId);
  assert.equal(contact.email, "john.doe@acme-expo.com");
  assert.deepEqual([contact.firstName, contact.lastName, contact.ownerId, contact.category, contact.lifecycle, contact.source],
    ["John", "Doe", "u1", "attendees", "prospect", "lead"]);
  const company = db.company.find(c => c.id === contact.companyId);
  assert.equal(company.domain, "acme-expo.com");
  assert.equal(company.name, "Acme-expo");
  acmeCompanyId = company.id;
  const deal = db.deal.find(d => d.contactId === acmeContactId);
  assert.equal(deal.stageId, stage("Interested").id);
  assert.equal(deal.externalKey, `lead:${r.data.lead.id}`);
  assert.equal(deal.title, "Booth enquiry");
  assert.ok(db.activity.some(a => a.externalKey === `lead:${r.data.lead.id}` && a.type === "lead_created"));

  // free-mail lead → no company
  r = await call("POST", "/api/leads/create-from-inbox", { token: T.u2, body: {
    email: "x@gmail.com", fromEmail: "sam@gmail.com", fromName: "Sam", subject: "Hi",
  }});
  const sam = db.contact.find(c => c.email === "sam@gmail.com");
  assert.equal(sam.companyId, null);
  assert.equal(sam.ownerId, "u2");

  // same client already a lead of another employee → friendly 409
  r = await call("POST", "/api/leads/create-from-inbox", { token: T.u2, body: { email: "a@b.c", fromEmail: "John.Doe@Acme-Expo.com" } });
  assert.equal(r.status, 409);
  assert.match(r.data.message, /another team member/);

  // updating the lead doesn't create a second deal
  const leadId = db.lead.find(l => l.fromEmail === "John.Doe@Acme-Expo.com").id;
  r = await call("PUT", `/api/leads/${leadId}`, { token: T.u1, body: { fromEmail: "John.Doe@Acme-Expo.com", subject: "Booth enquiry v2", leadType: "ATTENDEES" } });
  assert.equal(r.status, 200);
  assert.equal(db.deal.filter(d => d.contactId === acmeContactId).length, 1);
  console.log("✔ leads → contact (+name split, category), company from business domain only, deal in Interested, idempotent");
}

/* ══════════════════ 3. CONTACTS ══════════════════ */
{
  let r = await call("POST", "/api/crm/contacts", { token: T.u2, body: { email: "JOHN.doe@acme-expo.com" } });
  assert.equal(r.status, 409);
  assert.equal(r.data.contactId, acmeContactId);
  assert.match(r.data.message, /owner: Pawan/);

  r = await call("POST", "/api/crm/contacts", { token: T.u2, body: { email: "not-an-email" } });
  assert.equal(r.status, 400);

  r = await call("POST", "/api/crm/contacts", { token: T.u2, body: {
    email: "mary@acme-expo.com", firstName: "Mary", lastName: "Major", jobTitle: "CEO", tags: ["vip", "vip", " expo "], lifecycle: "lead",
  }});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const mary = r.data.data;
  assert.equal(mary.name, "Mary Major");
  assert.deepEqual(mary.tags, ["vip", "expo"]);
  assert.equal(mary.companyId, acmeCompanyId, "linked to existing company by domain");

  r = await call("POST", "/api/crm/contacts", { token: T.u2, body: { email: "z@z.io", ownerId: "u1" } });
  assert.equal(r.status, 403, "employee can't create for someone else");
  r = await call("POST", "/api/crm/contacts", { token: T.admin, body: { email: "zed@zeta.io", firstName: "Zed", ownerId: "u2" } });
  assert.equal(r.status, 201);
  assert.ok(db.notification.some(n => n.userId === "u2" && n.type === "contact_assigned"));

  // list: search by company name, owner filter, tag, lifecycle
  r = await call("GET", "/api/crm/contacts?search=acme", { token: T.u2 });
  assert.deepEqual(r.data.data.map(c => c.email).sort(), ["john.doe@acme-expo.com", "mary@acme-expo.com"]);
  const john = r.data.data.find(c => c.email.startsWith("john"));
  assert.equal(john.canEdit, false, "everyone can see, only owner edits");
  assert.equal(john.owner.name, "Pawan");
  assert.equal(john.company.name, "Acme-expo");
  assert.equal(john.openDeals, 1);
  r = await call("GET", "/api/crm/contacts?ownerId=me", { token: T.u2 });
  assert.deepEqual(r.data.data.map(c => c.email).sort(), ["mary@acme-expo.com", "sam@gmail.com", "zed@zeta.io"]);
  r = await call("GET", "/api/crm/contacts?tag=vip", { token: T.u1 });
  assert.deepEqual(r.data.data.map(c => c.email), ["mary@acme-expo.com"]);
  r = await call("GET", "/api/crm/contacts?lifecycle=prospect&pageSize=1&page=2", { token: T.u1 });
  assert.equal(r.data.pagination.total, 2);
  assert.equal(r.data.data.length, 1);

  // edit permissions
  r = await call("PUT", `/api/crm/contacts/${acmeContactId}`, { token: T.u2, body: { phone: "1" } });
  assert.equal(r.status, 403);
  r = await call("PUT", `/api/crm/contacts/${acmeContactId}`, { token: T.u1, body: { lifecycle: "wizard" } });
  assert.equal(r.status, 400);
  r = await call("PUT", `/api/crm/contacts/${acmeContactId}`, { token: T.u1, body: { lifecycle: "customer", jobTitle: "Buyer" } });
  assert.equal(r.status, 200);
  assert.ok(db.activity.some(a => a.contactId === acmeContactId && a.type === "status_change" && a.title === "Lifecycle: prospect → customer"));
  r = await call("PUT", `/api/crm/contacts/${acmeContactId}`, { token: T.admin, body: { ownerId: "u2" } });
  assert.equal(r.status, 200);
  assert.ok(db.activity.some(a => a.type === "owner_change" && a.title === "Owner: Pawan → Priya"));
  assert.ok(db.notification.some(n => n.userId === "u2" && n.link === `/crm/contacts/${acmeContactId}`));
  r = await call("PUT", `/api/crm/contacts/${acmeContactId}`, { token: T.admin, body: { ownerId: "nobody" } });
  assert.equal(r.status, 400);
  // back to u1 for the rest
  await call("PUT", `/api/crm/contacts/${acmeContactId}`, { token: T.admin, body: { ownerId: "u1" } });
  console.log("✔ contacts: unique per email (409 + owner), shared visibility, owner-only edits, admin reassign + notify, filters/paging");
}

/* ══════════════════ 4. REPLIES → CRM + TIMELINE ══════════════════ */
{
  // campaign history for john + a brand-new person who replies
  db.campaign.push({ id: 50, userId: "u1", name: "Expo Invite", status: "completed", sendType: "immediate" });
  const sentAt = new Date(Date.now() - 3 * 86400e3);
  db.campaignRecipient.push(
    { id: 500, campaignId: 50, email: "john.doe@acme-expo.com", status: "sent", accountId: 1, sentAt, sentSubject: "Expo 2026", sentFromEmail: "alice@gmail.com", retryCount: 0 },
    { id: 501, campaignId: 50, email: "newbie@startup.dev", status: "sent", accountId: 1, sentAt, sentSubject: "Expo 2026", sentFromEmail: "alice@gmail.com", retryCount: 0 },
  );
  db.emailBounce.push({ id: 9000, email: "john.doe@acme-expo.com", accountId: 1, campaignId: 50, type: "soft", statusCode: "4.2.2", diagnostic: "mailbox full", messageId: "b", createdAt: new Date(Date.now() - 2 * 86400e3) });

  const raw = Buffer.from([
    "From: New Bie <newbie@startup.dev>", "To: alice@gmail.com", "Subject: Re: Expo 2026",
    "Message-ID: <nb@startup.dev>", "In-Reply-To: <campaign-50-501@gmail.com>", `Date: ${new Date().toUTCString()}`,
    "Content-Type: text/plain", "", "Sounds good, send details.",
  ].join("\r\n"));
  const parsed = await simpleParser(raw);
  const account = { ...db.emailAccount[0] };
  const out = await inbound.processInboundMessage({ account, parsed, messageId: parsed.messageId, conversationId: "cv1", receivedAt: new Date(), rawSource: raw });
  assert.equal(out.kind, "reply");
  const newbie = db.contact.find(c => c.email === "newbie@startup.dev");
  assert.ok(newbie, "reply created a contact");
  assert.deepEqual([newbie.ownerId, newbie.source, newbie.lifecycle, newbie.firstName], ["u1", "reply", "prospect", "New"]);
  assert.equal(db.company.find(c => c.id === newbie.companyId)?.domain, "startup.dev");
  assert.ok(newbie.lastActivityAt);

  // John replies too (existing contact keeps owner + lifecycle customer)
  db.replyEvent.push({ id: 7000, email: "john.doe@acme-expo.com", accountId: 1, campaignId: 50, recipientId: 500, messageId: "<jr>", intent: "reply", matchedBy: "header", receivedAt: new Date(Date.now() - 86400e3), subject: "Re: Expo 2026", snippet: "Count me in", conversationId: "cv2" });

  // notes: anyone can add, only author/admin deletes; deal note shows on contact
  let r = await call("POST", "/api/crm/activities", { token: T.u2, body: { type: "call", body: "Spoke about booth size", contactId: acmeContactId } });
  assert.equal(r.status, 201);
  const callId = r.data.data.id;
  const dealId = db.deal.find(d => d.contactId === acmeContactId).id;
  r = await call("POST", "/api/crm/activities", { token: T.u1, body: { type: "note", body: "Budget approved", dealId } });
  assert.equal(r.status, 201);
  assert.equal(db.activity.find(a => a.id === r.data.data.id).contactId, acmeContactId, "deal note linked to contact");
  r = await call("POST", "/api/crm/activities", { token: T.u1, body: { type: "hack", body: "x", contactId: acmeContactId } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/crm/activities", { token: T.u1, body: { type: "note", body: "orphan" } });
  assert.equal(r.status, 400);
  r = await call("DELETE", `/api/crm/activities/${callId}`, { token: T.u1 });
  assert.equal(r.status, 403, "only author/admin");
  const sys = db.activity.find(a => a.type === "lead_created");
  r = await call("DELETE", `/api/crm/activities/${sys.id}`, { token: T.admin });
  assert.equal(r.status, 400, "system entries are permanent");

  // unified timeline
  db.suppressedEmail.push({ id: 8000, email: "john.doe@acme-expo.com", reason: "unsubscribe", createdAt: new Date(Date.now() - 1000), note: null });
  r = await call("GET", `/api/crm/contacts/${acmeContactId}/timeline?limit=50`, { token: T.u2 });
  assert.equal(r.status, 200);
  const kinds = r.data.data.map(i => i.kind === "activity" ? i.type : i.kind);
  for (const k of ["email_sent", "email_reply", "bounce", "suppressed", "call", "note", "lead_created", "status_change", "owner_change", "created"]) {
    assert.ok(kinds.includes(k), `timeline has ${k}: ${kinds}`);
  }
  const times = r.data.data.map(i => new Date(i.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
  assert.equal(r.data.data.find(i => i.kind === "email_sent").campaign.name, "Expo Invite");
  assert.equal(r.data.data.find(i => i.type === "call").canDelete, true, "author can delete own call");

  // paging
  const p1 = await call("GET", `/api/crm/contacts/${acmeContactId}/timeline?limit=3`, { token: T.u2 });
  assert.equal(p1.data.data.length, 3);
  assert.ok(p1.data.nextBefore);
  const p2 = await call("GET", `/api/crm/contacts/${acmeContactId}/timeline?limit=3&before=${encodeURIComponent(p1.data.nextBefore)}`, { token: T.u2 });
  assert.ok(p2.data.data.every(i => new Date(i.at) < new Date(p1.data.nextBefore)));

  // detail
  r = await call("GET", `/api/crm/contacts/${acmeContactId}`, { token: T.u2 });
  const d = r.data.data;
  assert.deepEqual([d.engagement.emailsSent, d.engagement.replies], [1, 1]);
  assert.equal(d.doNotContact.reason, "unsubscribe");
  assert.equal(d.deals[0].stage.name, "Interested");
  assert.equal(d.leads.length, 1);
  assert.equal(d.canEdit, false);
  console.log("✔ replies create contacts + companies; notes/calls with permissions; unified timeline (sends, replies, bounces, opt-out, notes) sorted + paged");
}

/* ══════════════════ 5. COMPANIES ══════════════════ */
{
  let r = await call("POST", "/api/crm/companies", { token: T.u2, body: { name: "Globex", website: "https://www.globex.com/x" } });
  assert.equal(r.status, 201);
  assert.equal(r.data.data.domain, "globex.com", "domain derived from website");
  r = await call("POST", "/api/crm/companies", { token: T.u1, body: { name: "Globex Copy", domain: "GLOBEX.com" } });
  assert.equal(r.status, 409);
  r = await call("POST", "/api/crm/companies", { token: T.u1, body: { name: "" } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/crm/companies", { token: T.u1, body: { name: "Bad", domain: "not a domain" } });
  assert.equal(r.status, 400);
  r = await call("GET", `/api/crm/companies/${acmeCompanyId}`, { token: T.u2 });
  assert.equal(r.data.data.contactCount, 2);
  assert.equal(r.data.data.contacts.length, 2);
  assert.equal(r.data.data.openDeals, 1);
  r = await call("GET", "/api/crm/companies?search=glob", { token: T.u1 });
  assert.deepEqual(r.data.data.map(c => c.name), ["Globex"]);
  r = await call("PUT", `/api/crm/companies/${acmeCompanyId}`, { token: T.u2, body: { industry: "Events" } });
  assert.equal(r.status, 403);
  r = await call("PUT", `/api/crm/companies/${acmeCompanyId}`, { token: T.u1, body: { industry: "Events", domain: "globex.com" } });
  assert.equal(r.status, 409, "domain clash on update");
  console.log("✔ companies: domain normalisation + uniqueness, counts, search, owner-only edits");
}

/* ══════════════════ 6. DEALS / BOARD ══════════════════ */
{
  let r = await call("POST", "/api/crm/deals", { token: T.u1, body: { title: "", contactId: acmeContactId } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/crm/deals", { token: T.u1, body: { title: "Big booth", amount: "12000.456", currency: "usd", contactId: acmeContactId } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const big = r.data.data;
  assert.deepEqual([big.amount, big.currency, big.stage.name, big.companyId], [12000.46, "USD", "New", acmeCompanyId]);
  r = await call("POST", "/api/crm/deals", { token: T.u1, body: { title: "Neg", amount: -5 } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/crm/deals", { token: T.u2, body: { title: "Small", amount: 500, currency: "INR", stageId: stage("New").id } });
  const small = r.data.data;
  r = await call("POST", "/api/crm/deals", { token: T.u2, body: { title: "Mid", amount: 900, stageId: stage("New").id } });
  const mid = r.data.data;

  r = await call("GET", "/api/crm/deals/board", { token: T.u1 });
  let col = r.data.data.find(s => s.name === "New");
  assert.deepEqual(col.deals.map(d => d.title), ["Big booth", "Small", "Mid"]);
  assert.equal(col.count, 3);
  assert.deepEqual(col.totals.sort((a, b) => a.currency.localeCompare(b.currency)), [{ currency: "INR", amount: 500 }, { currency: "USD", amount: 12900.46 }]);
  assert.equal(col.deals.find(d => d.title === "Small").canEdit, false);

  // reorder within column: Mid between Big and Small
  r = await call("PATCH", `/api/crm/deals/${mid.id}/move`, { token: T.u2, body: { stageId: stage("New").id, beforeId: big.id, afterId: small.id } });
  assert.equal(r.status, 200);
  r = await call("GET", "/api/crm/deals/board", { token: T.u1 });
  assert.deepEqual(r.data.data.find(s => s.name === "New").deals.map(d => d.title), ["Big booth", "Mid", "Small"]);

  // permissions
  r = await call("PATCH", `/api/crm/deals/${big.id}/move`, { token: T.u2, body: { stageId: stage("Won").id } });
  assert.equal(r.status, 403);
  r = await call("PATCH", `/api/crm/deals/${big.id}/move`, { token: T.u1, body: { stageId: 99999 } });
  assert.equal(r.status, 400);

  // win → closed + contact customer (set earlier; set to prospect first to observe)
  db.contact.find(c => c.id === acmeContactId).lifecycle = "prospect";
  r = await call("PATCH", `/api/crm/deals/${big.id}/move`, { token: T.u1, body: { stageId: stage("Won").id } });
  let row = db.deal.find(d => d.id === big.id);
  assert.equal(row.status, "won");
  assert.ok(row.closedAt);
  assert.equal(db.contact.find(c => c.id === acmeContactId).lifecycle, "customer");
  assert.ok(db.activity.some(a => a.dealId === big.id && a.type === "stage_change" && a.title === "Big booth: New → Won"));

  // reopen clears close data; lost keeps reason
  await call("PATCH", `/api/crm/deals/${big.id}/move`, { token: T.u1, body: { stageId: stage("Interested").id } });
  row = db.deal.find(d => d.id === big.id);
  assert.deepEqual([row.status, row.closedAt], ["open", null]);
  await call("PATCH", `/api/crm/deals/${small.id}/move`, { token: T.u2, body: { stageId: stage("Lost").id, lostReason: "No budget" } });
  row = db.deal.find(d => d.id === small.id);
  assert.deepEqual([row.status, row.lostReason], ["lost", "No budget"]);

  // update via PUT with stage change + owner reassignment
  r = await call("PUT", `/api/crm/deals/${mid.id}`, { token: T.admin, body: { stageId: stage("negotiation").id, ownerId: "u1", expectedCloseAt: "2026-12-01" } });
  assert.equal(r.status, 200);
  row = db.deal.find(d => d.id === mid.id);
  assert.deepEqual([row.stageId, row.ownerId], [stage("negotiation").id, "u1"]);
  assert.ok(db.notification.some(n => n.userId === "u1" && n.type === "deal_assigned"));
  r = await call("PUT", `/api/crm/deals/${mid.id}`, { token: T.u1, body: { expectedCloseAt: "not a date" } });
  assert.equal(r.status, 400);

  // filters
  r = await call("GET", "/api/crm/deals?status=lost", { token: T.u1 });
  assert.deepEqual(r.data.data.map(d => d.title), ["Small"]);
  assert.equal(r.data.data[0].stage.name, "Lost");
  r = await call("GET", "/api/crm/deals/board?ownerId=me&search=big", { token: T.u1 });
  assert.deepEqual(r.data.data.flatMap(s => s.deals.map(d => d.title)), ["Big booth"]);
  r = await call("GET", `/api/crm/deals/${big.id}`, { token: T.u2 });
  assert.equal(r.data.data.stage.name, "Interested");
  assert.ok(r.data.data.activities.length >= 3);

  // stage deletion rules
  r = await call("DELETE", `/api/crm/stages/${stage("negotiation").id}`, { token: T.admin });
  assert.equal(r.status, 409, "stage with deals can't be removed");
  await call("PATCH", `/api/crm/deals/${mid.id}/move`, { token: T.u1, body: { stageId: stage("Proposal Sent").id } });
  r = await call("DELETE", `/api/crm/stages/${stage("negotiation").id}`, { token: T.admin });
  assert.equal(r.status, 200);
  r = await call("GET", "/api/crm/stages", { token: T.u1 });
  assert.equal(r.data.data.some(s => s.name === "negotiation"), false, "archived stage hidden");
  r = await call("DELETE", `/api/crm/stages/${stage("New").id}`, { token: T.admin });
  assert.equal(r.status, 400, "default stage can't be removed");
  console.log("✔ deals: validation, board grouping/totals/order, drag reorder, won/lost/reopen, activity log, filters, stage archive rules");
}

/* ══════════════════ 7. TASKS + REMINDERS + NOTIFICATIONS ══════════════════ */
{
  const inOneHour = new Date(Date.now() + 3600e3).toISOString();
  const yesterday = new Date(Date.now() - 86400e3).toISOString();
  let r = await call("POST", "/api/crm/tasks", { token: T.u1, body: { title: "Send brochure", dueAt: inOneHour, contactId: acmeContactId, assignedToId: "u2", priority: "high" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const t1 = r.data.data;
  assert.equal(t1.remindAt, inOneHour, "reminder defaults to due time");
  assert.equal(t1.contact.email, "john.doe@acme-expo.com");
  assert.ok(db.notification.some(n => n.userId === "u2" && n.type === "task_assigned" && n.title.includes("Send brochure")));

  r = await call("POST", "/api/crm/tasks", { token: T.u2, body: { title: "Overdue call", dueAt: yesterday } });
  const t2 = r.data.data;
  r = await call("POST", "/api/crm/tasks", { token: T.u2, body: { title: "Someday" } });
  r = await call("POST", "/api/crm/tasks", { token: T.u2, body: { title: "x", priority: "urgent" } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/crm/tasks", { token: T.u2, body: { title: "x", assignedToId: "nobody" } });
  assert.equal(r.status, 400);

  r = await call("GET", "/api/crm/tasks?view=overdue&tz=0", { token: T.u2 });
  assert.deepEqual(r.data.data.map(t => t.title), ["Overdue call"]);
  assert.equal(r.data.data[0].overdue, true);
  assert.deepEqual([r.data.counts.overdue, r.data.counts.open], [1, 3]);
  r = await call("GET", "/api/crm/tasks?view=upcoming&tz=0", { token: T.u2 });
  assert.ok(r.data.data.some(t => t.title === "Someday"));
  r = await call("GET", "/api/crm/tasks?assignee=u1", { token: T.u2 });
  assert.equal(r.status, 403, "employees see only their own list");
  r = await call("GET", "/api/crm/tasks?assignee=all", { token: T.u1 });
  assert.ok(r.data.data.every(t => t.assignedToId === "u1"), "non-admin 'all' falls back to own");
  r = await call("GET", "/api/crm/tasks?assignee=all", { token: T.admin });
  // 3 created here + 1 created automatically by the reply automation (Phase 3)
  assert.equal(r.data.data.length, 4);
  r = await call("GET", `/api/crm/tasks?contactId=${acmeContactId}`, { token: T.u1 });
  assert.deepEqual(r.data.data.map(t => t.title), ["Send brochure"], "record tasks visible to everyone");

  // permissions: creator, assignee, admin
  r = await call("PUT", `/api/crm/tasks/${t2.id}`, { token: T.u1, body: { title: "hijack" } });
  assert.equal(r.status, 403);
  r = await call("PATCH", `/api/crm/tasks/${t1.id}/complete`, { token: T.u2, body: { done: true } });
  assert.equal(r.data.data.status, "done");
  r = await call("PATCH", `/api/crm/tasks/${t1.id}/complete`, { token: T.u1, body: { done: true } });
  assert.equal(db.activity.filter(a => a.type === "task_completed" && a.title === "Task completed: Send brochure").length, 1, "double click logs once");
  r = await call("PATCH", `/api/crm/tasks/${t1.id}/complete`, { token: T.u1, body: { done: false } });
  assert.deepEqual([r.data.data.status, r.data.data.completedAt], ["open", null]);

  // reminders: due now → one notification, then never again
  db.task.find(t => t.id === t2.id).remindAt = null; // created already overdue; not part of this check
  const tRow = db.task.find(t => t.id === t1.id);
  tRow.remindAt = new Date(Date.now() - 1000);
  const before = db.notification.filter(n => n.type === "task_reminder").length;
  assert.equal(await tasksCtrl.runTaskReminders(), 1);
  assert.equal(await tasksCtrl.runTaskReminders(), 0);
  const reminder = db.notification.filter(n => n.type === "task_reminder");
  assert.equal(reminder.length, before + 1);
  assert.equal(reminder.at(-1).userId, "u2");
  assert.equal(reminder.at(-1).link, `/crm/contacts/${acmeContactId}`);
  // rescheduling re-arms the reminder
  r = await call("PUT", `/api/crm/tasks/${t1.id}`, { token: T.u1, body: { dueAt: new Date(Date.now() - 500).toISOString() } });
  assert.equal(db.task.find(t => t.id === t1.id).reminderSentAt, null);
  assert.equal(await tasksCtrl.runTaskReminders(), 1);
  // done tasks never remind
  await call("PATCH", `/api/crm/tasks/${t2.id}/complete`, { token: T.u2, body: { done: true } });
  db.task.find(t => t.id === t2.id).remindAt = new Date(Date.now() - 1000);
  assert.equal(await tasksCtrl.runTaskReminders(), 0);

  // notifications API
  r = await call("GET", "/api/crm/notifications", { token: T.u2 });
  assert.ok(r.data.unread >= 3);
  const unreadBefore = r.data.unread;
  r = await call("POST", "/api/crm/notifications/read", { token: T.u2, body: { ids: [r.data.data[0].id] } });
  assert.equal(r.data.updated, 1);
  r = await call("POST", "/api/crm/notifications/read", { token: T.u1, body: { ids: db.notification.filter(n => n.userId === "u2").map(n => n.id) } });
  assert.equal(r.data.updated, 0, "can't mark someone else's");
  r = await call("GET", "/api/crm/notifications?unread=1", { token: T.u2 });
  assert.equal(r.data.unread, unreadBefore - 1);
  r = await call("POST", "/api/crm/notifications/read", { token: T.u2, body: { all: true } });
  r = await call("GET", "/api/crm/notifications", { token: T.u2 });
  assert.equal(r.data.unread, 0);
  // purge old read ones
  db.notification.forEach(n => { if (n.userId === "u2") n.createdAt = new Date(Date.now() - 90 * 86400e3); });
  assert.ok(await tasksCtrl.purgeOldNotifications() > 0);

  r = await call("GET", "/api/crm/users", { token: T.u1 });
  assert.deepEqual(r.data.data.map(u => u.name).sort(), ["Admin Boss", "Leaver", "Pawan", "Priya"]);
  console.log("✔ tasks: create/assign/notify, views (overdue/upcoming/all), permissions, complete-once, reminders once + re-armed, notifications read/purge");
}

/* ══════════════════ 8. DELETE USER → REASSIGN ══════════════════ */
{
  db.contact.push({ id: 90001, email: "leaverclient@x.io", ownerId: "gone", lifecycle: "lead", tags: [], companyId: null, createdAt: new Date(), updatedAt: new Date() });
  db.deal.push({ id: 90002, title: "Leaver deal", ownerId: "gone", stageId: stage("New").id, status: "open", position: 1, currency: "USD", createdAt: new Date(), updatedAt: new Date() });
  db.task.push({ id: 90003, title: "Leaver task", assignedToId: "gone", status: "open", createdAt: new Date(), updatedAt: new Date() });
  const r = await call("DELETE", "/api/users/gone", { token: T.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.reassignedToYou, { contacts: 1, companies: 0, deals: 1, tasks: 1, sequences: 0 });
  assert.equal(db.contact.find(c => c.id === 90001).ownerId, "admin");
  assert.equal(db.deal.find(d => d.id === 90002).ownerId, "admin");
  assert.equal(db.task.find(t => t.id === 90003).assignedToId, "admin");
  assert.equal(db.user.some(u => u.id === "gone"), false);
  console.log("✔ deleting a user hands their contacts/deals/open tasks to the admin");
}

/* ══════════════════ 9. DELETE CASCADES ══════════════════ */
{
  const dealId = db.deal.find(d => d.contactId === acmeContactId && d.title === "Big booth").id;
  let r = await call("DELETE", `/api/crm/contacts/${acmeContactId}`, { token: T.u2 });
  assert.equal(r.status, 403);
  r = await call("DELETE", `/api/crm/contacts/${acmeContactId}`, { token: T.u1 });
  assert.equal(r.status, 200);
  assert.equal(db.deal.find(d => d.id === dealId).contactId, null, "deal kept, unlinked");
  assert.equal(db.activity.some(a => a.contactId === acmeContactId), false, "contact activities removed");
  assert.equal(db.lead.find(l => l.fromEmail === "John.Doe@Acme-Expo.com").contactId, null, "lead kept, unlinked");
  r = await call("GET", `/api/crm/contacts/${acmeContactId}`, { token: T.u1 });
  assert.equal(r.status, 404);
  r = await call("DELETE", `/api/crm/companies/${acmeCompanyId}`, { token: T.u1 });
  assert.equal(r.status, 200);
  assert.equal(db.contact.find(c => c.email === "mary@acme-expo.com").companyId, null);
  console.log("✔ deleting contacts/companies keeps deals & leads (unlinked)");
}

console.log("\nPHASE 2 END-TO-END TESTS PASSED");
process.exit(0);
