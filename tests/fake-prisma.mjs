// Minimal in-memory Prisma stand-in covering the calls the send engine makes.
const db = globalThis.__db = {
  campaign: [], campaignRecipient: [], emailMessage: [], conversation: [],
  dailyEmailLog: [], pitchTemplate: [], emailAccount: [], user: [],
  suppressedEmail: [], emailBounce: [], replyEvent: [], tag: [], syncState: [],
  company: [], contact: [], pipelineStage: [], deal: [], activity: [], task: [], notification: [], lead: [],
  crmSetting: [], followupSequence: [], sequenceStep: [], sequenceEnrollment: [], accountDailySend: [],
};
// Schema defaults the mock applies on create (Prisma/Postgres would).
const DEFAULTS = {
  contact: () => ({ lifecycle: "lead", source: "manual", tags: [], companyId: null, lastActivityAt: null }),
  company: () => ({ domain: null }),
  pipelineStage: () => ({ kind: "open", color: "#0ea5e9", probability: 0, isDefault: false, archived: false }),
  deal: () => ({ currency: "USD", status: "open", position: 0, amount: null, contactId: null, companyId: null, closedAt: null, externalKey: null, lostReason: null, expectedCloseAt: null }),
  activity: () => ({ occurredAt: new Date(), externalKey: null, contactId: null, dealId: null, companyId: null, userId: null }),
  task: () => ({ status: "open", priority: "normal", dueAt: null, remindAt: null, reminderSentAt: null, completedAt: null, contactId: null, dealId: null }),
  notification: () => ({ readAt: null, body: null, link: null }),
  lead: () => ({ contactId: null }),
  followupSequence: () => ({ status: "draft", activatedAt: null, lastRunAt: null }),
  sequenceEnrollment: () => ({ stepsSent: 0, status: "active", nextDueAt: null, lastCampaignId: null, stoppedReason: null, lastStepAt: null }),
  replyEvent: () => ({ category: null, categorySource: null, confidence: null, handledAt: null, handledById: null, reviewStatus: null }),
  campaign: () => ({ sequenceId: null, sequenceStep: null }),
  accountDailySend: () => ({ count: 0 }),
  emailAccount: () => ({ dailyCap: null, warmupEnabled: false, warmupStartAt: null, warmupStartCap: null, warmupTarget: null }),
};
const HAS_UPDATED_AT = new Set(["contact", "company", "pipelineStage", "deal", "task", "lead", "followupSequence", "sequenceStep", "sequenceEnrollment", "crmSetting", "accountDailySend"]);
// Relation filters: key → [model, foreign key on this row]
const RELATIONS = {
  campaign: ["campaign", "campaignId"],
  company: ["company", "companyId"],
  contact: ["contact", "contactId"],
};
// onDelete behaviour for the mock's delete()
const ON_DELETE = {
  contact: [["activity", "contactId", "cascade"], ["task", "contactId", "cascade"], ["deal", "contactId", "null"], ["lead", "contactId", "null"]],
  company: [["contact", "companyId", "null"], ["deal", "companyId", "null"], ["activity", "companyId", "cascade"]],
  deal: [["activity", "dealId", "cascade"], ["task", "dealId", "cascade"]],
  user: [["notification", "userId", "cascade"], ["emailAccount", "userId", "cascade"]],
};
// Unique constraints enforced by the mock (P2002 like Prisma).
const UNIQUE = {
  suppressedEmail: [["email"]],
  emailBounce: [["accountId", "messageId"]],
  replyEvent: [["accountId", "messageId"]],
  user: [["email"]],
  contact: [["email"]],
  company: [["domain"]],
  deal: [["externalKey"]],
  activity: [["externalKey"]],
  lead: [["fromEmail"]],
  task: [["externalKey"]],
  followupSequence: [["campaignId"]],
  sequenceStep: [["sequenceId", "position"]],
  sequenceEnrollment: [["sequenceId", "email"]],
  crmSetting: [["key"]],
  accountDailySend: [["accountId", "day"]],
  emailAccount: [["email"]],
  emailMessage: [["emailAccountId", "messageId"]],
};
function checkUnique(name, row) {
  for (const cols of UNIQUE[name] || []) {
    if (cols.some(c => row[c] === null || row[c] === undefined)) continue; // NULLs never clash
    if (db[name].some(r => r !== row && cols.every(c => r[c] === row[c]))) {
      throw Object.assign(new Error(`Unique constraint failed on ${cols}`), { code: "P2002" });
    }
  }
}
let seq = 1000;
const clone = (o) => o && JSON.parse(JSON.stringify(o), (k, v) =>
  typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v);

function matchVal(v, cond) {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return cond instanceof Date ? +v === +cond : v === cond;
  }
  for (const [op, x] of Object.entries(cond)) {
    if (op === "in" && !x.includes(v)) return false;
    if (op === "notIn" && x.includes(v)) return false;
    if (op === "not") { if (x === null ? v === null || v === undefined : v === x) return false; }
    // SQL semantics: comparisons with NULL are never true.
    if (["lt", "lte", "gt", "gte"].includes(op) && (v === null || v === undefined)) return false;
    if (op === "lt" && !(v < x)) return false;
    if (op === "lte" && !(v <= x)) return false;
    if (op === "gte" && !(v >= x)) return false;
    if (op === "gt" && !(v > x)) return false;
    if (op === "equals" && v !== x) return false;
    if (op === "startsWith" && !(v !== null && String(v).startsWith(x))) return false;
    if (op === "endsWith" && !(v !== null && String(v).endsWith(x))) return false;
    if (op === "contains" && !(v !== null && String(v).toLowerCase().includes(String(x).toLowerCase()))) return false;
    if (op === "has" && !(Array.isArray(v) && v.includes(x))) return false;
  }
  return true;
}
function matches(row, where = {}) {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") { if (!cond.some(c => matches(row, c))) return false; continue; }
    if (k === "NOT") { if (matches(row, cond)) return false; continue; }
    if (k.includes("_") && typeof cond === "object" && !(k in row)) {
      if (!matches(row, cond)) return false; continue;
    }
    if (k === "rootOfSequence") {
      const has = db.followupSequence.some(x => x.campaignId === row.id);
      if (cond?.is === null ? has : !has) return false;
      continue;
    }
    if (RELATIONS[k] && cond && typeof cond === "object" && !(k in row && typeof row[k] !== "object")) {
      const [model, fk] = RELATIONS[k];
      const c = db[model].find(c => c.id === row[fk]);
      if (!c || !matches(c, cond)) return false; continue;
    }
    if (!matchVal(row[k] ?? null, cond)) return false;
  }
  return true;
}
function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in v) row[k] = (row[k] || 0) + v.increment;
    else row[k] = v;
  }
}
function project(row, select) {
  if (!row) return null;
  if (!select) return clone(row);
  const out = {};
  for (const [k, v] of Object.entries(select)) {
    if (!v) continue;
    if (k === "user" && typeof v === "object") { const u = db.user.find(u => u.id === row.userId); out.user = project(u, v.select); continue; }
    out[k] = row[k] ?? null;
  }
  return clone(out);
}
function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap(o => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [k, spec] of keys) {
      const dir = (typeof spec === "object" ? spec.sort : spec) === "asc" ? 1 : -1;
      const nulls = typeof spec === "object" ? spec.nulls : null;
      const va = a[k] ?? null, vb = b[k] ?? null;
      if (va === vb) continue;
      if (va === null) return nulls === "first" ? -1 : nulls === "last" ? 1 : dir;
      if (vb === null) return nulls === "first" ? 1 : nulls === "last" ? -1 : -dir;
      return (va > vb ? 1 : -1) * dir;
    }
    return 0;
  });
}
function withDefaults(name, data) {
  const now = new Date();
  return {
    ...(DEFAULTS[name] ? DEFAULTS[name]() : {}),
    createdAt: now,
    ...(HAS_UPDATED_AT.has(name) ? { updatedAt: now } : {}),
    ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
  };
}
function model(name) {
  const t = () => db[name];
  return {
    async findUnique({ where, select }) { return project(t().find(r => matches(r, where)), select); },
    async findFirst({ where, select, orderBy }) {
      const rows = sortRows(t().filter(r => matches(r, where)), orderBy);
      return project(rows[0], select);
    },
    async findMany({ where, select, orderBy, take, skip } = {}) {
      let rows = sortRows(t().filter(r => matches(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      return rows.map(r => project(r, select));
    },
    async count({ where } = {}) { return t().filter(r => matches(r, where)).length; },
    async create({ data, select }) {
      const row = { id: seq++, ...withDefaults(name, data) };
      checkUnique(name, row);
      t().push(row);
      return project(row, select);
    },
    async createMany({ data, skipDuplicates }) {
      let n = 0;
      for (const d of data) {
        if (name === "campaignRecipient" && t().some(r => r.campaignId === d.campaignId && r.email === d.email)) {
          if (skipDuplicates) continue; throw Object.assign(new Error("dup"), { code: "P2002" });
        }
        const row = { id: seq++, retryCount: 0, ...withDefaults(name, d) };
        checkUnique(name, row);
        t().push(row); n++;
      }
      return { count: n };
    },
    async update({ where, data, select }) {
      const row = t().find(r => matches(r, where));
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      const before = { ...row };
      applyData(row, data);
      try { checkUnique(name, row); } catch (e) { Object.assign(row, before); throw e; }
      if (HAS_UPDATED_AT.has(name)) row.updatedAt = new Date();
      return project(row, select);
    },
    async updateMany({ where, data }) {
      const rows = t().filter(r => matches(r, where));
      rows.forEach(r => { applyData(r, data); if (HAS_UPDATED_AT.has(name)) r.updatedAt = new Date(); });
      return { count: rows.length };
    },
    async delete({ where }) {
      const i = t().findIndex(r => matches(r, where));
      if (i < 0) throw Object.assign(new Error("nf"), { code: "P2025" });
      const [row] = t().splice(i, 1);
      for (const [child, fk, mode] of ON_DELETE[name] || []) {
        if (mode === "cascade") db[child] = db[child].filter(c => c[fk] !== row.id);
        else db[child].forEach(c => { if (c[fk] === row.id) c[fk] = null; });
      }
      return row;
    },
    async deleteMany({ where }) { const keep = t().filter(r => !matches(r, where)); const n = t().length - keep.length; db[name] = keep; return { count: n }; },
    async upsert({ where, update, create, select }) {
      let row = t().find(r => matches(r, where));
      if (row) applyData(row, update); else { row = { id: seq++, ...withDefaults(name, create) }; checkUnique(name, row); t().push(row); }
      return project(row, select);
    },
    async aggregate({ _sum, _max, where }) {
      const rows = t().filter(r => matches(r, where));
      const out = {};
      if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map(k => [k, rows.reduce((s, r) => s + (r[k] || 0), 0)]));
      if (_max) out._max = Object.fromEntries(Object.keys(_max).map(k => [k, rows.length ? Math.max(...rows.map(r => r[k] ?? -Infinity)) : null]));
      return out;
    },
    async groupBy({ by, where, _count, _sum, _min }) {
      const m = new Map();
      for (const r of t().filter(r => matches(r, where))) {
        const key = by.map(b => r[b]).join("|");
        const g = m.get(key) || {
          ...Object.fromEntries(by.map(b => [b, r[b] ?? null])),
          _count: { _all: 0 },
          ...(_sum ? { _sum: Object.fromEntries(Object.keys(_sum).map(k => [k, null])) } : {}),
          ...(_min ? { _min: Object.fromEntries(Object.keys(_min).map(k => [k, null])) } : {}),
        };
        g._count._all++;
        for (const k of Object.keys(_sum || {})) if (r[k] !== null && r[k] !== undefined) g._sum[k] = (g._sum[k] || 0) + Number(r[k]);
        for (const k of Object.keys(_min || {})) if (r[k] !== null && r[k] !== undefined && (g._min[k] === null || r[k] < g._min[k])) g._min[k] = r[k];
        m.set(key, g);
      }
      return [...m.values()];
    },
  };
}

// Emulates the raw statements used by the engine.
const lc = (e) => String(e || "").toLowerCase();
async function raw(strings, ...values) {
  const sql = strings.join("?");
  globalThis.__rawLog?.push(sql.slice(0, 40));
  // Trends use generate_series + several sub-selects; they are verified
  // against real PostgreSQL instead of being emulated here.
  if (sql.includes("generate_series")) return [];
  const R = db.campaignRecipient;
  const E = () => db.sequenceEnrollment;
  const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400e3);
  if (sql.includes('SELECT DISTINCT r."accountId"')) {
    const ids = new Set();
    for (const r of R) {
      const c = db.campaign.find(c => c.id === r.campaignId);
      if (c?.status === "sending" && ["pending", "processing"].includes(r.status) && r.accountId) ids.add(r.accountId);
    }
    return [...ids].map(accountId => ({ accountId }));
  }
  if (sql.includes('INSERT INTO "SequenceEnrollment"')) {
    const [seqId, delay, campaignId] = values; let n = 0;
    for (const r of R.filter(r => r.campaignId === campaignId && r.status === "sent" && r.sentAt && r.accountId)) {
      const email = String(r.email).toLowerCase();
      if (E().some(e => e.sequenceId === seqId && e.email === email)) continue;
      E().push({ id: seq++, sequenceId: seqId, email, rootRecipientId: r.id, accountId: r.accountId, nextDueAt: addDays(r.sentAt, delay),
        status: "active", stepsSent: 0, lastCampaignId: null, stoppedReason: null, createdAt: new Date(), updatedAt: new Date() });
      n++;
    }
    return n;
  }
  if (sql.includes('UPDATE "SequenceEnrollment" e') && sql.includes("'replied'")) {
    const [seqId] = values; let n = 0;
    for (const e of E().filter(e => e.sequenceId === seqId && ["active", "completed"].includes(e.status))) {
      const r = R.find(r => r.id === e.rootRecipientId);
      if (r && (r.repliedAt || db.replyEvent.some(x => x.email === e.email && x.receivedAt >= r.sentAt))) {
        Object.assign(e, { status: "replied", stoppedReason: "Replied", nextDueAt: null }); n++;
      }
    }
    return n;
  }
  if (sql.includes('UPDATE "SequenceEnrollment" e') && sql.includes("'bounced'")) {
    const [seqId] = values; let n = 0;
    for (const e of E().filter(e => e.sequenceId === seqId && e.status === "active")) {
      const r = R.find(r => r.id === e.rootRecipientId);
      if (r && (r.bounceType === "hard" || db.emailBounce.some(b => b.email === e.email && b.type === "hard" && b.createdAt >= r.sentAt))) {
        Object.assign(e, { status: "bounced", stoppedReason: "Address bounced", nextDueAt: null }); n++;
      }
    }
    return n;
  }
  if (sql.includes('UPDATE "SequenceEnrollment" e') && sql.includes("'unsubscribed'")) {
    const [seqId] = values; let n = 0;
    for (const e of E().filter(e => e.sequenceId === seqId && e.status === "active")) {
      if (db.suppressedEmail.some(s => s.email === e.email)) { Object.assign(e, { status: "unsubscribed", stoppedReason: "On do-not-contact list", nextDueAt: null }); n++; }
    }
    return n;
  }
  if (sql.includes('UPDATE "SequenceEnrollment" e') && sql.includes('"stepsSent" = e."stepsSent" + 1')) {
    const [nextDueAt, status, seqId, k, busy, limit] = values;
    const now = new Date();
    const due = E().filter(e => e.sequenceId === seqId && e.status === "active" && e.stepsSent === k && e.nextDueAt && e.nextDueAt <= now && !busy.includes(e.accountId))
      .sort((a, b) => a.id - b.id).slice(0, limit);
    for (const e of due) Object.assign(e, { stepsSent: e.stepsSent + 1, lastStepAt: now, nextDueAt, status });
    return due.map(e => ({ id: e.id, email: e.email, accountId: e.accountId }));
  }
  if (sql.includes('c."sequenceStep" AS step')) {
    const [ids] = values; const out = new Map();
    for (const c of db.campaign.filter(c => ids.includes(c.sequenceId))) {
      for (const r of R.filter(r => r.campaignId === c.id)) {
        const key = `${c.sequenceId}|${c.sequenceStep}`;
        const o = out.get(key) || { sequenceId: c.sequenceId, step: c.sequenceStep, sent: 0, queued: 0, skipped: 0, failed: 0, replied: 0 };
        if (r.status === "sent") o.sent++;
        if (["pending", "processing"].includes(r.status)) o.queued++;
        if (r.status === "skipped") o.skipped++;
        if (r.status === "failed") o.failed++;
        if (r.repliedAt) o.replied++;
        out.set(key, o);
      }
    }
    return [...out.values()];
  }
  if (sql.includes('FROM "SuppressedEmail" s')) {
    const [cid] = values; let n = 0;
    for (const r of R) {
      if (r.campaignId !== cid || r.status !== "pending") continue;
      const s2 = db.suppressedEmail.find(x => x.email === lc(r.email));
      if (s2) { r.status = "skipped"; r.error = "Suppressed: " + s2.reason; r.updatedAt = new Date(); n++; }
    }
    return n;
  }
  if (sql.includes('"ReplyEvent" e') && sql.includes("UPDATE")) {
    const [cid, oid] = values; let n = 0;
    for (const r of R) {
      if (r.campaignId !== cid || r.status !== "pending") continue;
      const hit = R.some(o => o.campaignId === oid && o.email === r.email && o.status === "sent" &&
        (o.repliedAt || db.replyEvent.some(e => e.email === lc(o.email) && e.receivedAt >= o.sentAt)));
      if (hit) { r.status = "skipped"; r.error = "Replied"; n++; }
    }
    return n;
  }
  if (sql.includes('FROM "Campaign" c') && sql.includes("'Replied'")) {
    const [email] = values; let n = 0;
    for (const r of R) {
      const c = db.campaign.find(c => c.id === r.campaignId);
      if (r.email === email && r.status === "pending" && c?.sendType === "followup") { r.status = "skipped"; r.error = "Replied"; n++; }
    }
    return n;
  }
  if (sql.includes('count(*) FILTER (WHERE "repliedAt"')) {
    const [ids] = values; const out = new Map();
    for (const r of R) {
      if (!ids.includes(r.campaignId)) continue;
      const o = out.get(r.campaignId) || { campaignId: r.campaignId, total: 0, sent: 0, pending: 0, processing: 0, failed: 0, skipped: 0, replied: 0, bounced: 0, unsubscribed: 0, lastSentAt: null };
      o.total++; if (o[r.status] !== undefined) o[r.status]++;
      if (r.repliedAt) o.replied++; if (r.bouncedAt) o.bounced++; if (r.unsubscribedAt) o.unsubscribed++;
      if (r.status === "sent" && r.sentAt && (!o.lastSentAt || r.sentAt > o.lastSentAt)) o.lastSentAt = r.sentAt;
      out.set(r.campaignId, o);
    }
    return [...out.values()];
  }
  if (sql.includes('SELECT "email" FROM "SuppressedEmail"')) {
    const [emails] = values;
    return db.suppressedEmail.filter(x => emails.includes(x.email)).map(x => ({ email: x.email }));
  }
  if (sql.includes("bool_or(")) {
    const [ids, emails] = values; const out = new Map();
    for (const o of R) {
      if (!ids.includes(o.campaignId) || !emails.includes(o.email) || o.status !== "sent") continue;
      const cur = out.get(o.email) || { email: o.email, replied: false, bounced: false };
      cur.replied ||= Boolean(o.repliedAt || db.replyEvent.some(e => e.email === o.email && e.receivedAt >= o.sentAt));
      cur.bounced ||= o.bounceType === "hard";
      out.set(o.email, cur);
    }
    return [...out.values()];
  }
  if (sql.includes('FROM "EmailAccount" a')) {
    const [since24, since7d] = values;
    const day = values.find(v => v instanceof Date && v !== since24 && v !== since7d) ?? null;
    const owner = values.find(v => typeof v === "string") ?? null;
    return db.emailAccount.filter(a => !a.deleted && (!owner || a.userId === owner)).map(a => {
      const u = db.user.find(u => u.id === a.userId) || {};
      const sent = R.filter(r => r.accountId === a.id && r.status === "sent" && r.sentAt >= since7d);
      const b = db.emailBounce.filter(x => x.accountId === a.id && x.createdAt >= since7d);
      return {
        id: a.id, email: a.email, provider: a.provider, senderName: a.senderName,
        sendingPausedAt: a.sendingPausedAt ?? null, sendingPausedReason: a.sendingPausedReason ?? null, sendingPausedUntil: a.sendingPausedUntil ?? null,
        ownerName: u.name, ownerEmail: u.email,
        sent24: sent.filter(r => r.sentAt >= since24).length, sent7d: sent.length,
        hard24: b.filter(x => x.type === "hard" && x.createdAt >= since24).length,
        soft24: b.filter(x => x.type === "soft" && x.createdAt >= since24).length,
        block24: b.filter(x => x.type === "block" && x.createdAt >= since24).length,
        bad7d: b.filter(x => ["hard", "block"].includes(x.type)).length,
        replies7d: db.replyEvent.filter(e => e.accountId === a.id && e.receivedAt >= since7d).length,
        sentToday: (db.accountDailySend.find(x => x.accountId === a.id && day && +x.day === +day)?.count) || 0,
        dailyCap: a.dailyCap ?? null,
        warmupEnabled: Boolean(a.warmupEnabled),
        warmupStartAt: a.warmupStartAt ?? null,
        warmupStartCap: a.warmupStartCap ?? null,
        warmupTarget: a.warmupTarget ?? null,
      };
    }).sort((x, y) => (x.sendingPausedAt ? 0 : 1) - (y.sendingPausedAt ? 0 : 1));
  }
  if (sql.includes("DISTINCT ON")) return [];
  if (sql.includes("SET \"status\" = 'processing'")) {
    const [campaignId, accountId, take] = values;
    const rows = db.campaignRecipient
      .filter(r => r.campaignId === campaignId && r.accountId === accountId && r.status === "pending")
      .sort((a, b) => a.id - b.id).slice(0, take);
    rows.forEach(r => { r.status = "processing"; r.updatedAt = new Date(); });
    return rows.map(r => ({ id: r.id, email: r.email, retryCount: r.retryCount }));
  }
  if (sql.includes('SELECT cr."id", cr."accountId"')) {
    const [cid, oid] = values;
    return db.campaignRecipient.filter(r => r.campaignId === cid && r.status === "pending" &&
      db.campaignRecipient.some(o => o.campaignId === oid && o.email === r.email && o.status === "sent"))
      .map(r => ({ id: r.id, accountId: r.accountId }));
  }
  if (sql.includes("NOT EXISTS")) {
    const [cid, oid] = values;
    const rows = db.campaignRecipient.filter(r => r.campaignId === cid && r.status === "pending" &&
      !db.campaignRecipient.some(o => o.campaignId === oid && o.email === r.email && o.status === "sent"));
    rows.forEach(r => { r.status = "failed"; r.error = "No original email found"; });
    return rows.length;
  }
  if (sql.includes('SELECT DISTINCT r."campaignId"')) {
    const [ids] = values;
    const out = new Map();
    db.campaignRecipient.filter(r => ids.includes(r.campaignId) && r.accountId && ["pending","processing"].includes(r.status))
      .forEach(r => out.set(`${r.campaignId}|${r.accountId}`, { campaignId: r.campaignId, accountId: r.accountId }));
    return [...out.values()];
  }
  if (sql.includes('UPDATE "Campaign"')) {
    const rows = db.campaign.filter(c => c.status === "scheduled" && c.scheduledAt && c.scheduledAt <= new Date());
    rows.forEach(c => c.status = "sending");
    return rows.map(c => ({ id: c.id, name: c.name }));
  }
  if (sql.includes("SELECT 1")) return [{ "?column?": 1 }];
  if (sql.includes("pg_advisory_xact_lock")) return 1;
  throw new Error("Unmocked raw SQL: " + sql.slice(0, 80));
}

export class PrismaClient {
  constructor() {
    for (const k of Object.keys(db)) this[k] = model(k);
    this.tag = model("user"); // unused
    this.$queryRaw = raw;
    this.$executeRaw = raw;
    this.$transaction = async (ops) => (typeof ops === "function" ? ops(this) : Promise.all(ops));
    this.$disconnect = async () => {};
  }
}
