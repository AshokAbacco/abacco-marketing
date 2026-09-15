// Minimal in-memory Prisma stand-in covering the calls the send engine makes.
const db = globalThis.__db = {
  campaign: [], campaignRecipient: [], emailMessage: [], conversation: [],
  dailyEmailLog: [], pitchTemplate: [], emailAccount: [], user: [],
};
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
    if (op === "lt" && !(v < x)) return false;
    if (op === "lte" && !(v <= x)) return false;
    if (op === "gte" && !(v >= x)) return false;
    if (op === "gt" && !(v > x)) return false;
    if (op === "equals" && v !== x) return false;
    if (op === "startsWith" && !String(v).startsWith(x)) return false;
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
    if (k === "campaign" && typeof cond === "object") {
      const c = db.campaign.find(c => c.id === row.campaignId);
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
function model(name) {
  const t = () => db[name];
  return {
    async findUnique({ where, select }) { return project(t().find(r => matches(r, where)), select); },
    async findFirst({ where, select, orderBy }) {
      let rows = t().filter(r => matches(r, where));
      if (orderBy) { const [[k, d]] = Object.entries(orderBy); rows.sort((a, b) => (a[k] > b[k] ? 1 : -1) * (d === "asc" ? 1 : -1)); }
      return project(rows[0], select);
    },
    async findMany({ where, select, orderBy, take } = {}) {
      let rows = t().filter(r => matches(r, where));
      if (orderBy) { const [[k, d]] = Object.entries(orderBy); rows.sort((a, b) => (a[k] > b[k] ? 1 : -1) * (d === "asc" ? 1 : -1)); }
      if (take) rows = rows.slice(0, take);
      return rows.map(r => project(r, select));
    },
    async count({ where }) { return t().filter(r => matches(r, where)).length; },
    async create({ data, select }) { const row = { id: seq++, createdAt: new Date(), ...data }; t().push(row); return project(row, select); },
    async createMany({ data, skipDuplicates }) {
      let n = 0;
      for (const d of data) {
        if (name === "campaignRecipient" && t().some(r => r.campaignId === d.campaignId && r.email === d.email)) {
          if (skipDuplicates) continue; throw Object.assign(new Error("dup"), { code: "P2002" });
        }
        t().push({ id: seq++, retryCount: 0, ...d }); n++;
      }
      return { count: n };
    },
    async update({ where, data, select }) {
      const row = t().find(r => matches(r, where));
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      applyData(row, data); return project(row, select);
    },
    async updateMany({ where, data }) { const rows = t().filter(r => matches(r, where)); rows.forEach(r => applyData(r, data)); return { count: rows.length }; },
    async delete({ where }) { const i = t().findIndex(r => matches(r, where)); if (i < 0) throw Object.assign(new Error("nf"), { code: "P2025" }); return t().splice(i, 1)[0]; },
    async deleteMany({ where }) { const keep = t().filter(r => !matches(r, where)); const n = t().length - keep.length; db[name] = keep; return { count: n }; },
    async upsert({ where, update, create, select }) {
      let row = t().find(r => matches(r, where));
      if (row) applyData(row, update); else { row = { id: seq++, createdAt: new Date(), ...create }; t().push(row); }
      return project(row, select);
    },
    async aggregate({ _sum, where }) {
      const rows = t().filter(r => matches(r, where));
      return { _sum: { count: rows.reduce((s, r) => s + r.count, 0) } };
    },
    async groupBy({ by, where }) {
      const m = new Map();
      for (const r of t().filter(r => matches(r, where))) {
        const key = by.map(b => r[b]).join("|");
        const g = m.get(key) || { ...Object.fromEntries(by.map(b => [b, r[b]])), _count: { _all: 0 } };
        g._count._all++; m.set(key, g);
      }
      return [...m.values()];
    },
  };
}

// Emulates the raw statements used by the engine.
async function raw(strings, ...values) {
  const sql = strings.join("?");
  globalThis.__rawLog?.push(sql.slice(0, 40));
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
  throw new Error("Unmocked raw SQL: " + sql.slice(0, 80));
}

export class PrismaClient {
  constructor() {
    for (const k of Object.keys(db)) this[k] = model(k);
    this.tag = model("user"); // unused
    this.$queryRaw = raw;
    this.$executeRaw = raw;
    this.$transaction = async (ops) => Promise.all(ops);
    this.$disconnect = async () => {};
  }
}
