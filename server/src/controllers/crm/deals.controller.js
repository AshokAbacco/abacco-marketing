// src/controllers/crm/deals.controller.js
import prisma from "../../prismaClient.js";
import { isAdminOrHr } from "../../middlewares/authMiddleware.js";
import {
  STAGE_KINDS,
  cleanStr,
  canEdit,
  attachUsers,
  displayName,
  toMoney,
  logActivity,
  notify,
  listStages,
  getDefaultStage,
  parseDateOrNull,
  resetStageCache,
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
const POSITION_STEP = 1000;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Decorate deals with stage, owner, contact and company summaries. */
async function decorate(deals, user) {
  if (!deals.length) return [];
  const contactIds = [...new Set(deals.map((d) => d.contactId).filter(Boolean))];
  const companyIds = [...new Set(deals.map((d) => d.companyId).filter(Boolean))];
  const [contacts, companies, users, openTasks] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, email: true, firstName: true, lastName: true, name: true },
        })
      : [],
    companyIds.length
      ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : [],
    attachUsers(deals),
    prisma.task.groupBy({
      by: ["dealId"],
      where: { dealId: { in: deals.map((d) => d.id) }, status: "open" },
      _count: { _all: true },
      _min: { dueAt: true },
    }),
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, { ...c, displayName: displayName(c) }]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const taskByDeal = new Map(openTasks.map((t) => [t.dealId, { count: t._count._all, nextDueAt: t._min?.dueAt || null }]));
  return deals.map((d) => ({
    ...d,
    amount: toMoney(d.amount),
    owner: users.get(d.ownerId) || null,
    contact: d.contactId ? contactById.get(d.contactId) || null : null,
    company: d.companyId ? companyById.get(d.companyId) || null : null,
    openTasks: taskByDeal.get(d.id)?.count || 0,
    nextTaskDueAt: taskByDeal.get(d.id)?.nextDueAt || null,
    canEdit: canEdit(user, d.ownerId),
  }));
}

function dealFilters(req) {
  const where = {};

  // FIX: previously a non-admin with no `ownerId` filter saw every user's
  // deals on the board and in the list (the client's default "All owners"
  // filter sends nothing). Non-admins are now always restricted to their
  // own records; only Admin/HR may request another owner's data or
  // everyone's.
  if (!isAdminOrHr(req.user)) {
    where.ownerId = req.user.id;
  } else if (req.query.ownerId === "me") {
    where.ownerId = req.user.id;
  } else if (req.query.ownerId) {
    where.ownerId = String(req.query.ownerId);
  }

  const search = cleanStr(req.query.search, 100);
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { contact: { email: { contains: search, mode: "insensitive" } } },
      { contact: { name: { contains: search, mode: "insensitive" } } },
      { company: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  for (const key of ["contactId", "companyId"]) {
    if (req.query[key]) {
      const n = Number(req.query[key]);
      if (Number.isInteger(n)) where[key] = n;
    }
  }
  return where;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOARD  GET /api/crm/deals/board?ownerId=&search=&perStage=100
═══════════════════════════════════════════════════════════════════════════ */
export const getBoard = async (req, res) => {
  try {
    const perStage = intParam(req.query.perStage, 100, 10, 300);
    const stages = await listStages();
    const where = dealFilters(req);

    const [perStageDeals, totals] = await Promise.all([
      Promise.all(
        stages.map((s) =>
          prisma.deal.findMany({
            where: { ...where, stageId: s.id },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: perStage,
          })
        )
      ),
      prisma.deal.groupBy({
        by: ["stageId", "currency"],
        where: { ...where, stageId: { in: stages.map((s) => s.id) } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const decorated = await decorate(perStageDeals.flat(), req.user);
    const byStage = new Map(stages.map((s) => [s.id, []]));
    for (const d of decorated) byStage.get(d.stageId)?.push(d);

    res.json({
      success: true,
      data: stages.map((s) => {
        const t = totals.filter((x) => x.stageId === s.id);
        return {
          ...s,
          deals: byStage.get(s.id) || [],
          count: t.reduce((sum, x) => sum + x._count._all, 0),
          totals: t
            .filter((x) => x._sum?.amount !== null && x._sum?.amount !== undefined)
            .map((x) => ({ currency: x.currency, amount: toMoney(x._sum.amount) })),
        };
      }),
      canManageStages: isAdminOrHr(req.user),
    });
  } catch (err) {
    return serverError(res, "getBoard", err);
  }
};

/* LIST  GET /api/crm/deals?status=open|won|lost&page= */
export const listDeals = async (req, res) => {
  try {
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 25, 1, 100);
    const where = dealFilters(req);
    if (STAGE_KINDS.includes(req.query.status)) where.status = req.query.status;
    const [rows, total] = await Promise.all([
      prisma.deal.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.deal.count({ where }),
    ]);
    const stages = await listStages({ includeArchived: true });
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const data = (await decorate(rows, req.user)).map((d) => ({ ...d, stage: stageById.get(d.stageId) || null }));
    res.json({ success: true, data, pagination: { page, pageSize, total } });
  } catch (err) {
    return serverError(res, "listDeals", err);
  }
};

/* DETAIL  GET /api/crm/deals/:id */
export const getDeal = async (req, res) => {
  try {
    const id = idParam(req);
    const deal = id ? await prisma.deal.findUnique({ where: { id } }) : null;
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });

    // FIX: a non-admin could previously fetch ANY deal by id — the board and
    // list filtered results, but the detail route had no ownership check at
    // all. Block non-owners (unless Admin/HR) the same way edits already do.
    if (!canEdit(req.user, deal.ownerId)) {
      return res.status(404).json({ success: false, message: "Deal not found" });
    }

    const [[decorated], stage, tasks, activities] = await Promise.all([
      decorate([deal], req.user),
      prisma.pipelineStage.findUnique({ where: { id: deal.stageId } }),
      prisma.task.findMany({ where: { dealId: id }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 100 }),
      prisma.activity.findMany({ where: { dealId: id }, orderBy: { occurredAt: "desc" }, take: 100 }),
    ]);
    const users = await attachUsers([...tasks, ...activities], ["assignedToId", "userId"]);
    res.json({
      success: true,
      data: {
        ...decorated,
        stage,
        tasks: tasks.map((t) => ({ ...t, assignedTo: users.get(t.assignedToId) || null })),
        activities: activities.map((a) => ({ ...a, user: a.userId ? users.get(a.userId) || null : null })),
      },
    });
  } catch (err) {
    return serverError(res, "getDeal", err);
  }
};

async function validateDealBody(body, { partial }) {
  const data = {};
  if (!partial || body.title !== undefined) {
    const title = cleanStr(body.title, 200);
    if (!title) return { error: "Deal title is required" };
    data.title = title;
  }
  if (body.amount !== undefined) {
    if (body.amount === null || body.amount === "") data.amount = null;
    else {
      const n = Number(body.amount);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return { error: "Amount must be a positive number" };
      data.amount = Math.round(n * 100) / 100;
    }
  }
  if (body.currency !== undefined) {
    const c = String(body.currency || "").toUpperCase();
    if (!CURRENCY_RE.test(c)) return { error: "Currency must be a 3-letter code (USD, INR, EUR…)" };
    data.currency = c;
  }
  if (body.expectedCloseAt !== undefined) {
    const d = parseDateOrNull(body.expectedCloseAt);
    if (d === undefined) return { error: "Invalid expected close date" };
    data.expectedCloseAt = d;
  }
  if (body.lostReason !== undefined) data.lostReason = cleanStr(body.lostReason, 300);
  if (body.source !== undefined) data.source = cleanStr(body.source, 50);
  for (const [key, model] of [["contactId", "contact"], ["companyId", "company"]]) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === "") { data[key] = null; continue; }
    const n = Number(body[key]);
    if (!Number.isInteger(n)) return { error: `Invalid ${key}` };
    const row = await prisma[model].findUnique({ where: { id: n }, select: { id: true, companyId: model === "contact" } });
    if (!row) return { error: `${model} not found` };
    data[key] = n;
    if (model === "contact" && body.companyId === undefined && row.companyId) data.companyId = row.companyId;
  }
  return { data };
}

/* CREATE  POST /api/crm/deals */
export const createDeal = async (req, res) => {
  try {
    const { data, error } = await validateDealBody(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ success: false, message: error });

    let stage;
    if (req.body.stageId) {
      stage = await prisma.pipelineStage.findUnique({ where: { id: Number(req.body.stageId) } });
      if (!stage || stage.archived) return res.status(400).json({ success: false, message: "Stage not found" });
    } else {
      stage = await getDefaultStage();
    }

    let ownerId = req.user.id;
    if (req.body.ownerId && req.body.ownerId !== req.user.id) {
      if (!isAdminOrHr(req.user)) {
        return res.status(403).json({ success: false, message: "Only Admin/HR can create deals for someone else" });
      }
      ownerId = String(req.body.ownerId);
    }

    const last = await prisma.deal.findFirst({
      where: { stageId: stage.id }, orderBy: { position: "desc" }, select: { position: true },
    });
    const deal = await prisma.deal.create({
      data: {
        ...data,
        stageId: stage.id,
        status: stage.kind,
        closedAt: stage.kind === "open" ? null : new Date(),
        ownerId,
        position: (last?.position ?? 0) + POSITION_STEP,
        source: data.source || "manual",
      },
    });

    await logActivity({
      type: "created", title: `Deal created in ${stage.name}`,
      dealId: deal.id, contactId: deal.contactId, userId: req.user.id,
    });
    if (ownerId !== req.user.id) {
      await notify(ownerId, { type: "deal_assigned", title: `Deal assigned to you: ${deal.title}`, link: `/crm/deals?open=${deal.id}` });
    }
    const [decorated] = await decorate([deal], req.user);
    res.status(201).json({ success: true, data: { ...decorated, stage } });
  } catch (err) {
    if (err.code === "P2003") return res.status(400).json({ success: false, message: "Owner not found" });
    return serverError(res, "createDeal", err);
  }
};

/** Apply a stage change: status, closedAt, activity. */
async function changeStage(deal, stage, user, { position, lostReason } = {}) {
  const data = { stageId: stage.id, status: stage.kind };
  if (position !== undefined) data.position = position;
  if (stage.kind === "open") {
    data.closedAt = null;
    data.lostReason = null;
  } else if (deal.status !== stage.kind || !deal.closedAt) {
    data.closedAt = new Date();
  }
  if (stage.kind === "lost" && lostReason !== undefined) data.lostReason = cleanStr(lostReason, 300);

  const updated = await prisma.deal.update({ where: { id: deal.id }, data });
  if (deal.stageId !== stage.id) {
    const from = await prisma.pipelineStage.findUnique({ where: { id: deal.stageId }, select: { name: true } });
    await logActivity({
      type: "stage_change",
      title: `${deal.title}: ${from?.name || "?"} → ${stage.name}`,
      meta: { fromStageId: deal.stageId, toStageId: stage.id, status: stage.kind },
      dealId: deal.id,
      contactId: deal.contactId,
      userId: user.id,
    });
    if (stage.kind === "won" && deal.contactId) {
      await prisma.contact.updateMany({ where: { id: deal.contactId, lifecycle: { not: "customer" } }, data: { lifecycle: "customer" } });
    }
  }
  return updated;
}

/* UPDATE  PUT /api/crm/deals/:id */
export const updateDeal = async (req, res) => {
  try {
    const id = idParam(req);
    const deal = id ? await prisma.deal.findUnique({ where: { id } }) : null;
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });
    if (!canEdit(req.user, deal.ownerId)) {
      return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can edit this deal" });
    }

    const { data, error } = await validateDealBody(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });

    let newOwner = null;
    if (req.body.ownerId !== undefined && req.body.ownerId !== deal.ownerId) {
      data.ownerId = String(req.body.ownerId);
      newOwner = data.ownerId;
    }

    let updated = Object.keys(data).length ? await prisma.deal.update({ where: { id }, data }) : deal;

    if (req.body.stageId !== undefined && Number(req.body.stageId) !== deal.stageId) {
      const stage = await prisma.pipelineStage.findUnique({ where: { id: Number(req.body.stageId) } });
      if (!stage || stage.archived) return res.status(400).json({ success: false, message: "Stage not found" });
      const last = await prisma.deal.findFirst({
        where: { stageId: stage.id }, orderBy: { position: "desc" }, select: { position: true },
      });
      updated = await changeStage(updated, stage, req.user, {
        position: (last?.position ?? 0) + POSITION_STEP,
        lostReason: req.body.lostReason,
      });
    }

    if (newOwner && newOwner !== req.user.id) {
      await notify(newOwner, { type: "deal_assigned", title: `Deal assigned to you: ${updated.title}`, link: `/crm/deals?open=${id}` });
    }
    const [decorated] = await decorate([updated], req.user);
    res.json({ success: true, data: decorated });
  } catch (err) {
    if (err.code === "P2003") return res.status(400).json({ success: false, message: "Owner not found" });
    return serverError(res, "updateDeal", err);
  }
};

/* MOVE  PATCH /api/crm/deals/:id/move { stageId, beforeId?, afterId?, lostReason? }
   beforeId = the card that ends up directly ABOVE, afterId = directly BELOW. */
export const moveDeal = async (req, res) => {
  try {
    const id = idParam(req);
    const deal = id ? await prisma.deal.findUnique({ where: { id } }) : null;
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });
    if (!canEdit(req.user, deal.ownerId)) {
      return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can move this deal" });
    }
    const stage = await prisma.pipelineStage.findUnique({ where: { id: Number(req.body?.stageId) } });
    if (!stage || stage.archived) return res.status(400).json({ success: false, message: "Stage not found" });

    const neighbour = async (nid) => {
      if (!nid) return null;
      const n = await prisma.deal.findUnique({ where: { id: Number(nid) }, select: { position: true, stageId: true } });
      return n && n.stageId === stage.id ? n : null;
    };
    const [above, below] = await Promise.all([neighbour(req.body.beforeId), neighbour(req.body.afterId)]);

    let position;
    if (above && below) position = (above.position + below.position) / 2;
    else if (above) position = above.position + POSITION_STEP;
    else if (below) position = below.position - POSITION_STEP;
    else {
      const last = await prisma.deal.findFirst({
        where: { stageId: stage.id, id: { not: id } }, orderBy: { position: "desc" }, select: { position: true },
      });
      position = (last?.position ?? 0) + POSITION_STEP;
    }

    // Positions converge after many moves between the same two cards —
    // renumber the column when the gap gets too small.
    if (above && below && Math.abs(below.position - above.position) < 1e-6) {
      const col = await prisma.deal.findMany({
        where: { stageId: stage.id, id: { not: id } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true },
      });
      await prisma.$transaction(col.map((c, i) =>
        prisma.deal.update({ where: { id: c.id }, data: { position: (i + 1) * POSITION_STEP } })
      ));
      return moveDeal(req, res);
    }

    const updated = await changeStage(deal, stage, req.user, { position, lostReason: req.body.lostReason });
    res.json({ success: true, data: { id: updated.id, stageId: updated.stageId, position: updated.position, status: updated.status } });
  } catch (err) {
    return serverError(res, "moveDeal", err);
  }
};

/* DELETE  /api/crm/deals/:id */
export const deleteDeal = async (req, res) => {
  try {
    const id = idParam(req);
    const deal = id ? await prisma.deal.findUnique({ where: { id }, select: { id: true, ownerId: true } }) : null;
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });
    if (!canEdit(req.user, deal.ownerId)) {
      return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can delete this deal" });
    }
    await prisma.deal.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "deleteDeal", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   PIPELINE STAGES  (read: everyone, write: Admin/HR)
═══════════════════════════════════════════════════════════════════════════ */
function stageFields(body, { partial }) {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = cleanStr(body.name, 50);
    if (!name) return { error: "Stage name is required" };
    data.name = name;
  }
  if (body.kind !== undefined) {
    if (!STAGE_KINDS.includes(body.kind)) return { error: "kind must be open, won or lost" };
    data.kind = body.kind;
  }
  if (body.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(String(body.color))) return { error: "color must look like #0ea5e9" };
    data.color = String(body.color).toLowerCase();
  }
  if (body.probability !== undefined) {
    const p = Number(body.probability);
    if (!Number.isInteger(p) || p < 0 || p > 100) return { error: "probability must be 0–100" };
    data.probability = p;
  }
  if (body.isDefault !== undefined) data.isDefault = Boolean(body.isDefault);
  return { data };
}

export const getStages = async (req, res) => {
  try {
    const stages = await listStages();
    const counts = await prisma.deal.groupBy({ by: ["stageId"], _count: { _all: true } });
    const byId = new Map(counts.map((c) => [c.stageId, c._count._all]));
    res.json({
      success: true,
      data: stages.map((s) => ({ ...s, dealCount: byId.get(s.id) || 0 })),
      canManage: isAdminOrHr(req.user),
    });
  } catch (err) {
    return serverError(res, "getStages", err);
  }
};

async function clearOtherDefaults(exceptId) {
  await prisma.pipelineStage.updateMany({ where: { isDefault: true, id: { not: exceptId } }, data: { isDefault: false } });
}

export const createStage = async (req, res) => {
  try {
    const { data, error } = stageFields(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ success: false, message: error });
    const stages = await listStages();
    if (stages.some((s) => s.name.toLowerCase() === data.name.toLowerCase())) {
      return res.status(409).json({ success: false, message: "A stage with this name already exists" });
    }
    const maxPos = stages.reduce((m, s) => Math.max(m, s.position), 0);
    const stage = await prisma.pipelineStage.create({ data: { ...data, position: maxPos + 10 } });
    if (stage.isDefault) await clearOtherDefaults(stage.id);
    res.status(201).json({ success: true, data: stage });
  } catch (err) {
    return serverError(res, "createStage", err);
  }
};

export const updateStage = async (req, res) => {
  try {
    const id = idParam(req);
    const stage = id ? await prisma.pipelineStage.findUnique({ where: { id } }) : null;
    if (!stage || stage.archived) return res.status(404).json({ success: false, message: "Stage not found" });
    const { data, error } = stageFields(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });
    if (data.name) {
      const clash = (await listStages()).find((s) => s.id !== id && s.name.toLowerCase() === data.name.toLowerCase());
      if (clash) return res.status(409).json({ success: false, message: "A stage with this name already exists" });
    }
    if (data.isDefault === false && stage.isDefault) {
      return res.status(400).json({ success: false, message: "Choose another default stage instead" });
    }
    const updated = await prisma.pipelineStage.update({ where: { id }, data });
    if (data.isDefault) await clearOtherDefaults(id);
    // Deals follow their stage's kind.
    if (data.kind && data.kind !== stage.kind) {
      await prisma.deal.updateMany({
        where: { stageId: id },
        data: { status: data.kind, closedAt: data.kind === "open" ? null : new Date() },
      });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    return serverError(res, "updateStage", err);
  }
};

/* PUT /api/crm/stages/reorder { ids: [3,1,2,...] } */
export const reorderStages = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const stages = await listStages();
    const known = new Set(stages.map((s) => s.id));
    if (ids.length !== stages.length || !ids.every((i) => known.has(i)) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ success: false, message: "ids must list every active stage exactly once" });
    }
    await prisma.$transaction(ids.map((sid, i) =>
      prisma.pipelineStage.update({ where: { id: sid }, data: { position: (i + 1) * 10 } })
    ));
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "reorderStages", err);
  }
};

/* DELETE /api/crm/stages/:id — only when empty; archived, not removed */
export const deleteStage = async (req, res) => {
  try {
    const id = idParam(req);
    const stage = id ? await prisma.pipelineStage.findUnique({ where: { id } }) : null;
    if (!stage || stage.archived) return res.status(404).json({ success: false, message: "Stage not found" });
    const active = await listStages();
    if (active.length <= 2) return res.status(400).json({ success: false, message: "A pipeline needs at least two stages" });
    if (stage.isDefault) return res.status(400).json({ success: false, message: "Make another stage the default first" });
    const inUse = await prisma.deal.count({ where: { stageId: id } });
    if (inUse) {
      return res.status(409).json({ success: false, message: `Move the ${inUse} deal(s) in this stage first`, dealCount: inUse });
    }
    await prisma.pipelineStage.update({ where: { id }, data: { archived: true } });
    resetStageCache();
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "deleteStage", err);
  }
};