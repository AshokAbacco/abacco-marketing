import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "x";
await import("@prisma/client");
const db = globalThis.__db;
db.user.push({ id: "u1", email: "a@x", name: "A" }, { id: "u2", email: "b@x", name: "B" });
const d = (days) => new Date(Date.now() - days * 86400e3);
db.lead.push(
  { id: 1, userId: "u2", email: "x", fromEmail: "buyer@bigcorp.com", fromName: "Big Buyer", leadType: "INDUSTRY", subject: "RFQ", createdAt: d(30), contactId: null },
  { id: 2, userId: "u1", email: "y", fromEmail: null, name: "Second", createdAt: d(20), contactId: null },           // no valid email at all
  { id: 3, userId: "u1", email: "solo@gmail.com", fromEmail: null, fromName: "Solo", createdAt: d(10), contactId: null },
  { id: 4, userId: "u1", email: "z", fromEmail: "BUYER2@bigcorp.com", website: "bigcorp.com", createdAt: d(5), contactId: null },
);
const argv = process.argv;
// dry run
argv.push("--dry");
await import(`${new URL("../scripts/", import.meta.url).pathname}migrateLeadsToCrm.js?dry`);
assert.equal(db.contact.length, 0, "dry run writes nothing");
// apply twice
argv.push("--apply");
await import(`${new URL("../scripts/", import.meta.url).pathname}migrateLeadsToCrm.js?run1`);
const snapshot = JSON.stringify({ c: db.contact.length, co: db.company.length, d: db.deal.length, a: db.activity.length });
await import(`${new URL("../scripts/", import.meta.url).pathname}migrateLeadsToCrm.js?run2`);
assert.equal(JSON.stringify({ c: db.contact.length, co: db.company.length, d: db.deal.length, a: db.activity.length }), snapshot, "re-run adds nothing");

assert.deepEqual(db.contact.map(c => c.email).sort(), ["buyer2@bigcorp.com", "buyer@bigcorp.com", "solo@gmail.com"]);
assert.equal(db.company.length, 1, "one company for bigcorp.com");
assert.equal(db.contact.find(c => c.email === "buyer@bigcorp.com").ownerId, "u2");
assert.equal(db.contact.find(c => c.email === "buyer@bigcorp.com").category, "industry");
assert.equal(db.deal.length, 3);
assert.ok(db.deal.every(x => db.pipelineStage.find(s => s.id === x.stageId).name === "Interested"));
const leadAct = db.activity.find(a => a.externalKey === "lead:1");
assert.equal(+leadAct.occurredAt, +db.lead.find(l => l.id === 1).createdAt, "history keeps the original lead date");
assert.equal(db.lead.find(l => l.id === 2).contactId, null);
assert.ok([1, 3, 4].every(id => db.lead.find(l => l.id === id).contactId));
console.log("✔ migration: dry run writes nothing, apply is idempotent, owners/companies/deals/dates correct");

// Board renumbering when positions converge
const { moveDeal } = await import(`${new URL("../src/", import.meta.url).pathname}controllers/crm/deals.controller.js`);
const s = db.pipelineStage[0];
db.deal.push(
  { id: 801, title: "A", ownerId: "u1", stageId: s.id, status: "open", position: 5, currency: "USD" },
  { id: 802, title: "B", ownerId: "u1", stageId: s.id, status: "open", position: 5 + 1e-9, currency: "USD" },
  { id: 803, title: "C", ownerId: "u1", stageId: s.id, status: "open", position: 9000, currency: "USD" },
);
const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
await moveDeal({ params: { id: "803" }, body: { stageId: s.id, beforeId: 801, afterId: 802 }, user: { id: "u1", jobRole: "Employee" } }, res);
assert.equal(res.code, 200, JSON.stringify(res.body));
const order = db.deal.filter(x => x.stageId === s.id && [801, 802, 803].includes(x.id)).sort((a, b) => a.position - b.position).map(x => x.title);
assert.deepEqual(order, ["A", "C", "B"]);
console.log("✔ board: converged positions are renumbered and the move still lands in place");
process.exit(0);
