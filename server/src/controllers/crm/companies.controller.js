// src/controllers/crm/companies.controller.js
import prisma from "../../prismaClient.js";
import { isAdminOrHr } from "../../middlewares/authMiddleware.js";
import {
  cleanStr,
  normalizeDomain,
  canEdit,
  attachUsers,
  displayName,
  toMoney,
  logActivity,
} from "../../services/crm.service.js";

const intParam = (v, fallback, min, max) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};
const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
function serverError(res, label, err) {
  console.error(`${label}:`, err);
  return res.status(500).json({ success: false, message: "Server error" });
}

function companyFields(body) {
  const data = {};
  if (body.name !== undefined) {
    const name = cleanStr(body.name, 200);
    if (!name) return { error: "Company name is required" };
    data.name = name;
  }
  if (body.domain !== undefined) {
    if (body.domain === null || body.domain === "") data.domain = null;
    else {
      const d = normalizeDomain(body.domain);
      if (!d) return { error: "Invalid domain (example: acme.com)" };
      data.domain = d;
    }
  }
  for (const [key, max] of [["website", 300], ["industry", 100], ["country", 100], ["phone", 50], ["size", 50]]) {
    if (body[key] !== undefined) data[key] = cleanStr(body[key], max);
  }
  if (body.notes !== undefined) data.notes = cleanStr(body.notes, 10_000);
  return { data };
}

async function withCounts(rows) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return rows;
  const [contacts, deals, users] = await Promise.all([
    prisma.contact.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _count: { _all: true } }),
    prisma.deal.groupBy({
      by: ["companyId"], where: { companyId: { in: ids }, status: "open" },
      _count: { _all: true }, _sum: { amount: true },
    }),
    attachUsers(rows),
  ]);
  const c = new Map(contacts.map((x) => [x.companyId, x._count._all]));
  const d = new Map(deals.map((x) => [x.companyId, { count: x._count._all, value: toMoney(x._sum?.amount) || 0 }]));
  return rows.map((r) => ({
    ...r,
    owner: users.get(r.ownerId) || null,
    contactCount: c.get(r.id) || 0,
    openDeals: d.get(r.id)?.count || 0,
    openDealValue: d.get(r.id)?.value || 0,
  }));
}

/* GET /api/crm/companies */
export const listCompanies = async (req, res) => {
  try {
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 25, 1, 100);
    const search = cleanStr(req.query.search, 100);
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { domain: { contains: search.toLowerCase() } },
      ];
    }
    if (req.query.ownerId === "me") where.ownerId = req.user.id;
    else if (req.query.ownerId) where.ownerId = String(req.query.ownerId);

    const [rows, total] = await Promise.all([
      prisma.company.findMany({
        where,
        orderBy: req.query.sort === "name" ? [{ name: "asc" }] : [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.company.count({ where }),
    ]);

    const data = await withCounts(rows);
    res.json({
      success: true,
      data: data.map((r) => ({ ...r, canEdit: canEdit(req.user, r.ownerId) })),
      pagination: { page, pageSize, total },
    });
  } catch (err) {
    return serverError(res, "listCompanies", err);
  }
};

/* GET /api/crm/companies/:id */
export const getCompany = async (req, res) => {
  try {
    const id = idParam(req);
    const company = id ? await prisma.company.findUnique({ where: { id } }) : null;
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    const [contacts, deals, activities] = await Promise.all([
      prisma.contact.findMany({
        where: { companyId: id },
        orderBy: [{ updatedAt: "desc" }],
        take: 200,
        select: {
          id: true, email: true, firstName: true, lastName: true, name: true,
          jobTitle: true, phone: true, lifecycle: true, ownerId: true, lastActivityAt: true,
        },
      }),
      prisma.deal.findMany({ where: { companyId: id }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100 }),
      prisma.activity.findMany({ where: { companyId: id }, orderBy: { occurredAt: "desc" }, take: 50 }),
    ]);
    const stageIds = [...new Set(deals.map((d) => d.stageId))];
    const [stages, users] = await Promise.all([
      stageIds.length ? prisma.pipelineStage.findMany({ where: { id: { in: stageIds } } }) : [],
      attachUsers([company, ...contacts, ...deals, ...activities], ["ownerId", "userId"]),
    ]);
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const [withMeta] = await withCounts([company]);

    res.json({
      success: true,
      data: {
        ...withMeta,
        canEdit: canEdit(req.user, company.ownerId),
        contacts: contacts.map((c) => ({ ...c, displayName: displayName(c), owner: users.get(c.ownerId) || null })),
        deals: deals.map((d) => ({
          ...d, amount: toMoney(d.amount), stage: stageById.get(d.stageId) || null, owner: users.get(d.ownerId) || null,
        })),
        activities: activities.map((a) => ({ ...a, user: a.userId ? users.get(a.userId) || null : null })),
      },
    });
  } catch (err) {
    return serverError(res, "getCompany", err);
  }
};

/* POST /api/crm/companies */
export const createCompany = async (req, res) => {
  try {
    const { data, error } = companyFields({ ...req.body, name: req.body?.name ?? "" });
    if (error) return res.status(400).json({ success: false, message: error });

    if (!data.domain && data.website) data.domain = normalizeDomain(data.website);
    if (data.domain) {
      const existing = await prisma.company.findUnique({ where: { domain: data.domain }, select: { id: true, name: true } });
      if (existing) {
        return res.status(409).json({
          success: false, message: `A company with domain ${data.domain} already exists (${existing.name})`, companyId: existing.id,
        });
      }
    }

    let ownerId = req.user.id;
    if (req.body.ownerId && req.body.ownerId !== req.user.id) {
      if (!isAdminOrHr(req.user)) {
        return res.status(403).json({ success: false, message: "Only Admin/HR can create companies for someone else" });
      }
      ownerId = String(req.body.ownerId);
    }

    const company = await prisma.company.create({ data: { ...data, ownerId } });
    await logActivity({ type: "created", title: "Company created", companyId: company.id, userId: req.user.id });
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "Domain already in use" });
    if (err.code === "P2003") return res.status(400).json({ success: false, message: "Owner not found" });
    return serverError(res, "createCompany", err);
  }
};

/* PUT /api/crm/companies/:id */
export const updateCompany = async (req, res) => {
  try {
    const id = idParam(req);
    const company = id ? await prisma.company.findUnique({ where: { id }, select: { id: true, ownerId: true } }) : null;
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    if (!canEdit(req.user, company.ownerId)) {
      return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can edit this company" });
    }
    const { data, error } = companyFields(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    if (req.body.ownerId !== undefined && req.body.ownerId !== company.ownerId) data.ownerId = String(req.body.ownerId);

    const updated = await prisma.company.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "Domain already in use" });
    if (err.code === "P2003") return res.status(400).json({ success: false, message: "Owner not found" });
    return serverError(res, "updateCompany", err);
  }
};

/* DELETE /api/crm/companies/:id — contacts and deals stay, unlinked */
export const deleteCompany = async (req, res) => {
  try {
    const id = idParam(req);
    const company = id ? await prisma.company.findUnique({ where: { id }, select: { id: true, ownerId: true } }) : null;
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    if (!canEdit(req.user, company.ownerId)) {
      return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can delete this company" });
    }
    await prisma.company.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "deleteCompany", err);
  }
};
