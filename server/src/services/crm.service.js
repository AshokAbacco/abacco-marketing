// src/services/crm.service.js
//
// Shared CRM logic used by the CRM API, the leads controller, the inbound
// (reply) processor, the worker and the migration script.
//
// Sharing model: one Contact per email address company-wide, one owner.
// Everyone can read; the owner or Admin/HR can change a record.

import prisma from "../prismaClient.js";
import { isAdminOrHr } from "../middlewares/authMiddleware.js";

/* ── Configuration ─────────────────────────────────────────────────────── */

export const CRM_FEATURES = {
  autoContacts: !["false", "0", "off"].includes(
    String(process.env.FEATURE_CRM_AUTO_CONTACTS ?? "true").toLowerCase(),
  ),
};

export const LIFECYCLES = ["lead", "prospect", "customer", "lost"];
export const CONTACT_SOURCES = [
  "lead",
  "reply",
  "manual",
  "import",
  "campaign",
];
export const ACTIVITY_TYPES_MANUAL = ["note", "call", "meeting", "email"];
export const TASK_PRIORITIES = ["low", "normal", "high"];
export const STAGE_KINDS = ["open", "won", "lost"];

export const DEFAULT_STAGES = [
  {
    name: "New",
    kind: "open",
    color: "#64748b",
    probability: 5,
    isDefault: true,
  },
  { name: "Contacted", kind: "open", color: "#0ea5e9", probability: 10 },
  { name: "Replied", kind: "open", color: "#6366f1", probability: 20 },
  { name: "Interested", kind: "open", color: "#f59e0b", probability: 40 },
  { name: "Proposal Sent", kind: "open", color: "#8b5cf6", probability: 60 },
  { name: "Won", kind: "won", color: "#10b981", probability: 100 },
  { name: "Lost", kind: "lost", color: "#ef4444", probability: 0 },
];

// Addresses at these domains are people, not companies.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "rediffmail.com",
  "zoho.com",
  "zohomail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "web.de",
]);

/* ── Small helpers ─────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function normalizeEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** Trimmed string or null, capped at `max` characters. */
export function cleanStr(value, max = 200) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

export function parseDateOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d; // undefined = invalid
}

export function splitName(full) {
  const clean = cleanStr(full, 200);
  if (!clean) return { firstName: null, lastName: null };
  const parts = clean.replace(/["']/g, "").split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function displayName(c) {
  if (!c) return "";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return full || c.name || c.email;
}

export function normalizeDomain(input) {
  let v = String(input || "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  v = v
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return null;
  return v;
}

export function businessDomainFromEmail(email) {
  const domain = String(email || "")
    .split("@")[1]
    ?.toLowerCase();
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null;
  return normalizeDomain(domain);
}

export function companyNameFromDomain(domain) {
  const base = String(domain || "").split(".")[0] || domain;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Unknown";
}

export function canEdit(user, ownerId) {
  return Boolean(user) && (user.id === ownerId || isAdminOrHr(user));
}

export function toMoney(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Attach { id, name, email } user objects for the given id fields. */
export async function attachUsers(rows, fields = ["ownerId"]) {
  const ids = new Set();
  for (const r of rows) for (const f of fields) if (r?.[f]) ids.add(r[f]);
  if (!ids.size) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, email: true },
  });
  return new Map(
    users.map((u) => [
      u.id,
      { id: u.id, name: u.name || u.email, email: u.email },
    ]),
  );
}

/* ── Pipeline stages ───────────────────────────────────────────────────── */

let stagesReady = false;

/** Create the default pipeline once (safe if two processes race). */
export async function ensureDefaultStages() {
  if (stagesReady) return;
  const count = await prisma.pipelineStage.count();
  if (count === 0) {
    await prisma.$transaction(async (tx) => {
      // Serialise concurrent first-time setup across processes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7302001)`;
      if ((await tx.pipelineStage.count()) > 0) return;
      await tx.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((s, i) => ({
          ...s,
          position: (i + 1) * 10,
          isDefault: Boolean(s.isDefault),
        })),
      });
    });
  }
  stagesReady = true;
}

export function resetStageCache() {
  stagesReady = false;
}

export async function listStages({ includeArchived = false } = {}) {
  await ensureDefaultStages();
  return prisma.pipelineStage.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

export async function getDefaultStage() {
  const stages = await listStages();
  return (
    stages.find((s) => s.isDefault && s.kind === "open") ||
    stages.find((s) => s.kind === "open") ||
    stages[0]
  );
}

export async function findStageByName(name) {
  const stages = await listStages();
  const wanted = String(name || "")
    .trim()
    .toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === wanted) || null;
}

/* ── Activities & notifications ────────────────────────────────────────── */

/**
 * Add a timeline entry. With `externalKey`, the same entry is never
 * created twice. Also bumps the contact's lastActivityAt.
 */
export async function logActivity({
  type,
  title = null,
  body = null,
  meta = null,
  occurredAt = new Date(),
  contactId = null,
  dealId = null,
  companyId = null,
  userId = null,
  externalKey = null,
}) {
  let activity = null;
  try {
    activity = await prisma.activity.create({
      data: {
        type,
        title: cleanStr(title, 300),
        body: body ? String(body).slice(0, 20_000) : null,
        meta: meta ?? undefined,
        occurredAt,
        contactId,
        dealId,
        companyId,
        userId,
        externalKey: externalKey ? String(externalKey).slice(0, 200) : null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") return null; // already logged
    throw err;
  }
  if (contactId) await touchContact(contactId, occurredAt);
  return activity;
}

export async function touchContact(contactId, at = new Date()) {
  await prisma.contact.updateMany({
    where: {
      id: contactId,
      OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }],
    },
    data: { lastActivityAt: at },
  });
}

export async function notify(
  userId,
  { type, title, body = null, link = null },
) {
  if (!userId) return null;
  return prisma.notification.create({
    data: {
      userId,
      type,
      title: String(title).slice(0, 200),
      body: body ? String(body).slice(0, 500) : null,
      link,
    },
  });
}

/* ── Companies & contacts ──────────────────────────────────────────────── */

/** Find or create the company for a business domain. */
export async function ensureCompanyForDomain({
  domain,
  name = null,
  ownerId,
  website = null,
}) {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const existing = await prisma.company.findUnique({ where: { domain: d } });
  if (existing) return existing;
  try {
    return await prisma.company.create({
      data: {
        domain: d,
        name: cleanStr(name, 200) || companyNameFromDomain(d),
        website: cleanStr(website, 300) || `https://${d}`,
        ownerId,
      },
    });
  } catch (err) {
    if (err.code === "P2002")
      return prisma.company.findUnique({ where: { domain: d } });
    throw err;
  }
}

/**
 * Find the contact for an email, or create it. Existing contacts keep their
 * owner and data; only EMPTY fields are filled in from `fields`.
 * @returns {Promise<{ contact: object, created: boolean } | null>}
 */
export async function ensureContact({
  email,
  ownerId,
  source = "manual",
  name = null,
  phone = null,
  country = null,
  website = null,
  category = null,
  jobTitle = null,
  createdById = null,
  linkCompany = true,
}) {
  const e = normalizeEmail(email);
  if (!e || !ownerId) return null;

  const incoming = {
    name: cleanStr(name, 200),
    phone: cleanStr(phone, 50),
    country: cleanStr(country, 100),
    website: cleanStr(website, 300),
    category: cleanStr(category, 50)?.toLowerCase() || null,
    jobTitle: cleanStr(jobTitle, 150),
  };

  let contact = await prisma.contact.findUnique({ where: { email: e } });

  if (contact) {
    const fill = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (v && !contact[k]) fill[k] = v;
    }
    if (incoming.name && !contact.firstName && !contact.lastName) {
      Object.assign(fill, splitName(incoming.name));
    }
    if (Object.keys(fill).length) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: fill,
      });
    }
    return { contact, created: false };
  }

  let companyId = null;
  if (linkCompany) {
    const domain =
      normalizeDomain(incoming.website) || businessDomainFromEmail(e);
    if (domain && !FREE_MAIL_DOMAINS.has(domain)) {
      const company = await ensureCompanyForDomain({
        domain,
        ownerId,
        website: incoming.website,
      });
      companyId = company?.id ?? null;
    }
  }

  try {
    contact = await prisma.contact.create({
      data: {
        email: e,
        ...incoming,
        ...splitName(incoming.name),
        source: CONTACT_SOURCES.includes(source) ? source : "manual",
        ownerId,
        companyId,
        createdById: createdById || ownerId,
      },
    });
    return { contact, created: true };
  } catch (err) {
    if (err.code === "P2002") {
      contact = await prisma.contact.findUnique({ where: { email: e } });
      return contact ? { contact, created: false } : null;
    }
    throw err;
  }
}

/**
 * Create the pipeline deal for a contact once (idempotent via externalKey).
 */
export async function ensureDealForContact({
  contact,
  ownerId,
  externalKey,
  stageName = null,
  title = null,
  source = null,
  occurredAt = new Date(),
}) {
  if (externalKey) {
    const existing = await prisma.deal.findUnique({ where: { externalKey } });
    if (existing) return { deal: existing, created: false };
  }
  const stage =
    (stageName && (await findStageByName(stageName))) ||
    (await getDefaultStage());
  if (!stage) return null;

  let companyName = null;
  if (contact.companyId) {
    const c = await prisma.company.findUnique({
      where: { id: contact.companyId },
      select: { name: true },
    });
    companyName = c?.name || null;
  }

  const last = await prisma.deal.findFirst({
    where: { stageId: stage.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  try {
    const deal = await prisma.deal.create({
      data: {
        title: cleanStr(title, 200) || `${companyName || displayName(contact)}`,
        stageId: stage.id,
        status: stage.kind,
        closedAt: stage.kind === "open" ? null : occurredAt,
        contactId: contact.id,
        companyId: contact.companyId ?? null,
        ownerId,
        source,
        externalKey,
        position: (last?.position ?? 0) + 1000,
        createdAt: occurredAt,
      },
    });
    await logActivity({
      type: "created",
      title: `Deal created in ${stage.name}`,
      contactId: contact.id,
      dealId: deal.id,
      userId: ownerId,
      occurredAt,
      externalKey: externalKey ? `deal-created:${externalKey}` : null,
    });
    return { deal, created: true };
  } catch (err) {
    if (err.code === "P2002" && externalKey) {
      const deal = await prisma.deal.findUnique({ where: { externalKey } });
      return deal ? { deal, created: false } : null;
    }
    throw err;
  }
}

/* ── Integration hooks ─────────────────────────────────────────────────── */

const LEAD_DEAL_STAGE = process.env.CRM_LEAD_DEAL_STAGE || "Interested";

/**
 * Called when a Lead is created/updated from the inbox (and by the
 * migration script). Links the lead to a contact, logs it, and makes sure
 * the contact has a pipeline deal.
 */
export async function syncLeadToCrm(lead, { withDeal = true } = {}) {
  const email = normalizeEmail(lead.fromEmail) || normalizeEmail(lead.email);
  if (!email) return null;

  const result = await ensureContact({
    email,
    ownerId: lead.userId,
    source: "lead",
    name: lead.fromName || lead.name,
    phone: lead.phone,
    country: lead.country,
    website: lead.website,
    category: lead.leadType ? String(lead.leadType).toLowerCase() : null,
  });
  if (!result) return null;
  const { contact } = result;

  if (lead.contactId !== contact.id) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { contactId: contact.id },
    });
  }

  const occurredAt = lead.createdAt ? new Date(lead.createdAt) : new Date();
  await logActivity({
    type: "lead_created",
    title: `Lead captured${lead.subject ? `: ${lead.subject}` : ""}`,
    meta: { leadId: lead.id, leadType: lead.leadType || null },
    contactId: contact.id,
    userId: lead.userId,
    occurredAt,
    externalKey: `lead:${lead.id}`,
  });

  if (contact.lifecycle === "lead") {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lifecycle: "prospect" },
    });
  }

  let deal = null;
  if (withDeal) {
    // One deal per contact from leads: reuse any open deal the contact has.
    const open = await prisma.deal.findFirst({
      where: { contactId: contact.id, status: "open" },
      select: { id: true },
    });
    if (!open) {
      const r = await ensureDealForContact({
        contact,
        ownerId: contact.ownerId,
        externalKey: `lead:${lead.id}`,
        stageName: LEAD_DEAL_STAGE,
        title: lead.subject ? String(lead.subject).slice(0, 120) : null,
        source: "lead",
        occurredAt,
      });
      deal = r?.deal || null;
    }
  }

  return { contact, deal, contactCreated: result.created };
}

/**
 * Called by the inbound processor when someone replies to a campaign.
 * Creates the contact if needed (owned by the mailbox owner) and marks it
 * as engaged.
 */
export async function syncReplyToCrm({ email, fromName, account, receivedAt }) {
  if (!CRM_FEATURES.autoContacts) return null;
  const result = await ensureContact({
    email,
    ownerId: account.userId,
    source: "reply",
    name: fromName,
  });
  if (!result) return null;
  const { contact } = result;
  await touchContact(contact.id, receivedAt);
  if (contact.lifecycle === "lead") {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lifecycle: "prospect" },
    });
  }
  return result;
}

/** Hand every CRM record of a user to someone else (before deleting them). */
export async function reassignCrmOwnership(fromUserId, toUserId, tx = prisma) {
  const [contacts, companies, deals, tasks, sequences] = await Promise.all([
    tx.contact.updateMany({
      where: { ownerId: fromUserId },
      data: { ownerId: toUserId },
    }),
    tx.company.updateMany({
      where: { ownerId: fromUserId },
      data: { ownerId: toUserId },
    }),
    tx.deal.updateMany({
      where: { ownerId: fromUserId },
      data: { ownerId: toUserId },
    }),
    tx.task.updateMany({
      where: { assignedToId: fromUserId, status: "open" },
      data: { assignedToId: toUserId },
    }),
    tx.followupSequence.updateMany({
      where: { ownerId: fromUserId },
      data: { ownerId: toUserId },
    }),
  ]);
  return {
    contacts: contacts.count,
    companies: companies.count,
    deals: deals.count,
    tasks: tasks.count,
    sequences: sequences.count,
  };
}
