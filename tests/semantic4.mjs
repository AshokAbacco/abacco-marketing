import pg from "pg";
import assert from "node:assert/strict";
import { extractSql } from "./extract.mjs";
const all = extractSql("/home/claude/work/server/src");
const pick = (file, needle) => {
  const hits = all.filter(s => s.file.includes(file) && s.sql.includes(needle));
  assert.equal(hits.length, 1, `${file} ${needle}: ${hits.length}`);
  return hits[0].sql;
};
const c = new pg.Client("postgresql://loadtest:loadtest@localhost:5433/abacco_p1");
await c.connect();
const q = (sql, p = []) => c.query(sql, p);
await q(`TRUNCATE "User","EmailAccount","Campaign","CampaignRecipient","SuppressedEmail","ReplyEvent","EmailBounce","AccountDailySend" RESTART IDENTITY CASCADE`);
await q(`INSERT INTO "User"(id,email,name) VALUES ('u1','u1@x','One'),('u2','u2@x','Two')`);
await q(`INSERT INTO "EmailAccount"(email,"userId",provider,"dailyCap","warmupEnabled") VALUES
 ('a@own.com','u1','gmail',NULL,true),('b@own.com','u1','custom',40,false),('c@own.com','u2','gmail',NULL,false)`);
const camp = (await q(`INSERT INTO "Campaign"(name,"userId","sendType",status) VALUES ('c','u1','immediate','completed') RETURNING id`)).rows[0].id;
const d = (n) => (n < 1 ? `now() - interval '6 hours'` : `now() - interval '${n} days'`);
const h12 = `now() - interval '12 hours'`;
await q(`INSERT INTO "CampaignRecipient"("campaignId",email,status,"accountId","sentAt","repliedAt") VALUES
 ($1,'x1@t.com','sent',1,${h12},${d(0)}), ($1,'x2@t.com','sent',1,${h12},NULL),
 ($1,'x3@t.com','sent',1,${d(3)},NULL), ($1,'x4@t.com','sent',3,${h12},NULL),
 ($1,'x5@t.com','sent',2,${d(20)},NULL)`, [camp]);
await q(`INSERT INTO "EmailBounce"(email,"accountId",type,"messageId","createdAt") VALUES
 ('x2@t.com',1,'hard','b1',${h12}), ('x3@t.com',1,'soft','b2',${d(3)}), ('x9@t.com',3,'block','b3',${h12})`);
await q(`INSERT INTO "ReplyEvent"(email,"accountId","messageId","matchedBy","receivedAt") VALUES ('x1@t.com',1,'m1','header',${d(0)})`);
await q(`INSERT INTO "SuppressedEmail"(email,reason,"accountId","createdAt") VALUES ('x7@t.com','unsubscribe',1,${h12}),('x8@t.com','hard_bounce',1,${h12})`);
const today = new Date(); today.setHours(17, 0, 0, 0);
await q(`INSERT INTO "AccountDailySend"("accountId","day","count","updatedAt") VALUES (1,$1,7,now()),(3,$1,2,now())`, [today]);

// account health (params: since24, since7d, since24 x3, since7d x2, day, owner x2)
const since24 = new Date(Date.now() - 24 * 3600e3), since7d = new Date(Date.now() - 7 * 86400e3);
const health = pick("deliverability.controller.js", 'FROM "EmailAccount" a');
let r = await q(health, [since24, since7d, since24, since24, since24, since7d, since7d, today, null, null]);
assert.equal(r.rows.length, 3);
const a1 = r.rows.find(x => x.email === "a@own.com");
assert.deepEqual([a1.sent24, a1.sent7d, a1.hard24, a1.soft24, a1.bad7d, a1.replies7d, a1.sentToday, a1.warmupEnabled],
  [2, 3, 1, 0, 1, 1, 7, true]);
assert.equal(r.rows.find(x => x.email === "b@own.com").dailyCap, 40);
r = await q(health, [since24, since7d, since24, since24, since24, since7d, since7d, today, "u2", "u2"]);
assert.deepEqual(r.rows.map(x => x.email), ["c@own.com"]);
console.log("✔ account health: today's counter joined, warm-up/cap columns, 24h & 7d windows, owner filter");

// trends (params: since x? and owner)
const trends = pick("deliverability.controller.js", "generate_series");
const since = new Date(Date.now() - 7 * 86400e3);
r = await q(trends, [since, null, null, since, since, since, since, null]);
assert.equal(r.rows.length, 8, "one row per day incl. today");
const day1 = r.rows.find(x => x.sent > 0 && x.hard > 0);
assert.ok(day1, "a day with sends and bounces");
const totals = r.rows.reduce((a, x) => ({ sent: a.sent + x.sent, replies: a.replies + x.replies, optouts: a.optouts + x.optouts, hard: a.hard + x.hard }), { sent: 0, replies: 0, optouts: 0, hard: 0 });
assert.deepEqual(totals, { sent: 4, replies: 1, optouts: 1, hard: 1 }, "20-day-old send excluded; only unsubscribe counted as opt-out");
r = await q(trends, [since, "u2", "u2", since, since, since, since, "u2"]);
const scoped = r.rows.reduce((a, x) => a + x.sent, 0);
assert.equal(scoped, 1, "scoped to that user's mailboxes");
console.log("✔ trends: one row per day, windows respected, per-user scoping");
await c.end();
console.log("\nREAL POSTGRES PHASE 4 CHECKS PASSED");
