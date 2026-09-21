// src/controllers/crm/automation.controller.js
// Replies triage, reply-automation settings and follow-up sequences.
import prisma from "../../prismaClient.js";
import { isAdminOrHr } from "../../middlewares/authMiddleware.js";
import { canEdit, attachUsers, displayName, listStages, cleanStr } from "../../services/crm.service.js";
import {
  REPLY_CATEGORIES,
  CATEGORY_LABELS,
  aiClassificationEnabled,
} from "../../services/replyClassifier.service.js";
import {
  applyReplyAutomation,
  getReplyAutomationSettings,
  validateReplyAutomation,
  saveSetting,
  stopAllEnrollments,
  MERGE_FIELDS,
} from "../../services/automation.service.js";

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

async function ownAccountIds(userId) {
  const rows = await prisma.emailAccount.findMany({ where: { userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPLIES  GET /api/crm/replies?category=&status=unhandled|handled|all&scope=mine|all&page=
═══════════════════════════════════════════════════════════════════════════ */
export const listReplies = async (req, res) => {
  try {
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 30, 1, 100);
    const base = {};

    const scopeAll = req.query.scope === "all" && isAdminOrHr(req.user);
    if (!scopeAll) base.accountId = { in: await ownAccountIds(req.user.id) };

    const status = ["handled", "all"].includes(req.query.status) ? req.query.status : "unhandled";
    if (status === "unhandled") base.handledAt = null;
    if (status === "handled") base.handledAt = { not: null };

    const where = { ...base };
    if (REPLY_CATEGORIES.includes(req.query.category)) where.category = req.query.category;

    const [rows, total, byCategory] = await Promise.all([
      prisma.replyEvent.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.replyEvent.count({ where }),
      prisma.replyEvent.groupBy({ by: ["category"], where: base, _count: { _all: true } }),
    ]);

    const emails = [...new Set(rows.map((r) => r.email))];
    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const campaignIds = [...new Set(rows.map((r) => r.campaignId).filter(Boolean))];
    const [contacts, accounts, campaigns] = await Promise.all([
      emails.length
        ? prisma.contact.findMany({
            where: { email: { in: emails } },
            select: { id: true, email: true, firstName: true, lastName: true, name: true, ownerId: true, companyId: true },
          })
        : [],
      accountIds.length
        ? prisma.emailAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, email: true } })
        : [],
      campaignIds.length
        ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const companyIds = [...new Set(contacts.map((c) => c.companyId).filter(Boolean))];
    const [companies, users] = await Promise.all([
      companyIds.length ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
      attachUsers([...contacts, ...rows], ["ownerId", "handledById"]),
    ]);
    const contactByEmail = new Map(contacts.map((c) => [c.email, c]));
    const accountById = new Map(accounts.map((a) => [a.id, a.email]));
    const campaignById = new Map(campaigns.map((c) => [c.id, c.name]));
    const companyById = new Map(companies.map((c) => [c.id, c.name]));

    res.json({
      success: true,
      data: rows.map((r) => {
        const c = contactByEmail.get(r.email);
        return {
          id: r.id,
          email: r.email,
          fromEmail: r.fromEmail,
          subject: r.subject,
          snippet: r.snippet,
          receivedAt: r.receivedAt,
          category: r.category,
          categorySource: r.categorySource,
          confidence: r.confidence,
          intent: r.intent,
          reviewStatus: r.reviewStatus,
          handledAt: r.handledAt,
          handledBy: r.handledById ? users.get(r.handledById) || null : null,
          conversationId: r.conversationId,
          accountId: r.accountId,
          accountEmail: accountById.get(r.accountId) || null,
          campaign: r.campaignId ? { id: r.campaignId, name: campaignById.get(r.campaignId) || null } : null,
          contact: c
            ? {
                id: c.id,
                displayName: displayName(c),
                owner: users.get(c.ownerId) || null,
                company: c.companyId ? companyById.get(c.companyId) || null : null,
              }
            : null,
        };
      }),
      counts: Object.fromEntries(byCategory.map((g) => [g.category || "unclassified", g._count._all])),
      pagination: { page, pageSize, total },
      labels: CATEGORY_LABELS,
      canViewAll: isAdminOrHr(req.user),
    });
  } catch (err) {
    return serverError(res, "listReplies", err);
  }
};

async function canAccessReply(user, reply) {
  if (isAdminOrHr(user)) return true;
  return (await ownAccountIds(user.id)).includes(reply.accountId);
}

/* PATCH /api/crm/replies/:id { category?, handled? } */
export const updateReply = async (req, res) => {
  try {
    const id = idParam(req);
    const reply = id ? await prisma.replyEvent.findUnique({ where: { id } }) : null;
    if (!reply || !(await canAccessReply(req.user, reply))) {
      return res.status(404).json({ success: false, message: "Reply not found" });
    }
    const data = {};
    const { category, handled } = req.body || {};
    if (category !== undefined) {
      if (!REPLY_CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: "Unknown category" });
      if (category !== reply.category) {
        Object.assign(data, { category, categorySource: "manual", confidence: 1 });
      }
    }
    if (handled !== undefined) {
      data.handledAt = handled ? new Date() : null;
      data.handledById = handled ? req.user.id : null;
    }
    if (!Object.keys(data).length) return res.json({ success: true, data: reply });

    const updated = await prisma.replyEvent.update({ where: { id }, data });

    let automation = null;
    if (data.category) {
      const contact = await prisma.contact.findUnique({ where: { email: updated.email } });
      if (contact) automation = await applyReplyAutomation({ replyEvent: updated, contact });
    }
    res.json({ success: true, data: updated, automation });
  } catch (err) {
    return serverError(res, "updateReply", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   REPLY AUTOMATION SETTINGS
═══════════════════════════════════════════════════════════════════════════ */
export const getAutomationSettings = async (req, res) => {
  try {
    const [settings, stages] = await Promise.all([getReplyAutomationSettings(), listStages()]);
    res.json({
      success: true,
      data: settings,
      stages: stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
      categories: REPLY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
      aiEnabled: aiClassificationEnabled(),
      canEdit: isAdminOrHr(req.user),
    });
  } catch (err) {
    return serverError(res, "getAutomationSettings", err);
  }
};

export const saveAutomationSettings = async (req, res) => {
  try {
    const { value, error } = validateReplyAutomation(req.body);
    if (error) return res.status(400).json({ success: false, message: error });
    const stages = await listStages();
    for (const [cat, rule] of Object.entries(value.rules)) {
      if (rule.stageId && !stages.some((s) => s.id === rule.stageId)) {
        return res.status(400).json({ success: false, message: `${cat}: stage not found` });
      }
    }
    await saveSetting("replyAutomation", value, req.user.id);
    res.json({ success: true, data: value });
  } catch (err) {
    return serverError(res, "saveAutomationSettings", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   SEQUENCES
═══════════════════════════════════════════════════════════════════════════ */
const MAX_STEPS = 10;
const MAX_BODY = 100_000;

function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return { error: "Add at least one step" };
  if (steps.length > MAX_STEPS) return { error: `At most ${MAX_STEPS} steps` };
  const out = [];
  for (const [i, s] of steps.entries()) {
    const delay = Number(s?.delayDays);
    if (!Number.isInteger(delay) || delay < 1 || delay > 90) return { error: `Step ${i + 1}: wait must be 1–90 days` };
    const body = String(s?.bodyHtml || "").trim();
    if (!body.replace(/<[^>]*>/g, "").trim()) return { error: `Step ${i + 1}: message is empty` };
    if (body.length > MAX_BODY) return { error: `Step ${i + 1}: message is too long` };
    out.push({ position: i + 1, delayDays: delay, bodyHtml: body });
  }
  return { steps: out };
}

async function sequenceStats(sequenceIds) {
  if (!sequenceIds.length) return new Map();
  const [byStatus, byStep] = await Promise.all([
    prisma.sequenceEnrollment.groupBy({ by: ["sequenceId", "status"], where: { sequenceId: { in: sequenceIds } }, _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT c."sequenceId", c."sequenceStep" AS step,
             count(*) FILTER (WHERE r."status" = 'sent')::int      AS sent,
             count(*) FILTER (WHERE r."status" IN ('pending','processing'))::int AS queued,
             count(*) FILTER (WHERE r."status" = 'skipped')::int   AS skipped,
             count(*) FILTER (WHERE r."status" = 'failed')::int    AS failed,
             count(*) FILTER (WHERE r."repliedAt" IS NOT NULL)::int AS replied
      FROM "Campaign" c
      JOIN "CampaignRecipient" r ON r."campaignId" = c."id"
      WHERE c."sequenceId" = ANY(${sequenceIds}::int[])
      GROUP BY c."sequenceId", c."sequenceStep"
    `,
  ]);
  const map = new Map(sequenceIds.map((id) => [id, { people: {}, total: 0, steps: {} }]));
  for (const g of byStatus) {
    const m = map.get(g.sequenceId);
    m.people[g.status] = g._count._all;
    m.total += g._count._all;
  }
  for (const r of byStep) {
    map.get(r.sequenceId).steps[r.step] = { sent: r.sent, queued: r.queued, skipped: r.skipped, failed: r.failed, replied: r.replied };
  }
  return map;
}

async function loadSequence(req, id) {
  const seq = id ? await prisma.followupSequence.findUnique({ where: { id } }) : null;
  if (!seq) return { error: [404, "Sequence not found"] };
  return { seq, editable: canEdit(req.user, seq.ownerId) };
}

/* GET /api/automation/sequences */
export const listSequences = async (req, res) => {
  try {
    const where = { status: req.query.status === "archived" ? "archived" : { not: "archived" } };
    if (!isAdminOrHr(req.user) || req.query.mine === "1") where.ownerId = req.user.id;
    const rows = await prisma.followupSequence.findMany({ where, orderBy: { updatedAt: "desc" } });
    const ids = rows.map((r) => r.id);
    const [stats, steps, campaigns, users] = await Promise.all([
      sequenceStats(ids),
      ids.length ? prisma.sequenceStep.groupBy({ by: ["sequenceId"], where: { sequenceId: { in: ids } }, _count: { _all: true } }) : [],
      ids.length
        ? prisma.campaign.findMany({ where: { id: { in: rows.map((r) => r.campaignId) } }, select: { id: true, name: true, status: true } })
        : [],
      attachUsers(rows),
    ]);
    const stepCount = new Map(steps.map((s) => [s.sequenceId, s._count._all]));
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));
    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        stepCount: stepCount.get(r.id) || 0,
        campaign: campaignById.get(r.campaignId) || null,
        owner: users.get(r.ownerId) || null,
        stats: stats.get(r.id),
        canEdit: canEdit(req.user, r.ownerId),
      })),
      mergeFields: MERGE_FIELDS,
    });
  } catch (err) {
    return serverError(res, "listSequences", err);
  }
};

/* GET /api/automation/sequences/candidates — base campaigns without a sequence */
export const listCandidateCampaigns = async (req, res) => {
  try {
    const where = {
      sendType: { not: "followup" },
      status: { in: ["sending", "completed", "stopped"] },
      rootOfSequence: { is: null },
    };
    if (!isAdminOrHr(req.user)) where.userId = req.user.id;
    const rows = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, status: true, createdAt: true, userId: true },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    return serverError(res, "listCandidateCampaigns", err);
  }
};

/* GET /api/automation/sequences/:id */
export const getSequence = async (req, res) => {
  try {
    const { seq, editable, error } = await loadSequence(req, idParam(req));
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    const [steps, campaign, stats, users] = await Promise.all([
      prisma.sequenceStep.findMany({ where: { sequenceId: seq.id }, orderBy: { position: "asc" } }),
      prisma.campaign.findUnique({ where: { id: seq.campaignId }, select: { id: true, name: true, status: true, userId: true } }),
      sequenceStats([seq.id]),
      attachUsers([seq]),
    ]);
    const baseSent = await prisma.campaignRecipient.count({ where: { campaignId: seq.campaignId, status: "sent" } });
    res.json({
      success: true,
      data: {
        ...seq,
        steps,
        campaign,
        baseSent,
        owner: users.get(seq.ownerId) || null,
        stats: stats.get(seq.id),
        canEdit: editable,
      },
    });
  } catch (err) {
    return serverError(res, "getSequence", err);
  }
};

/* POST /api/automation/sequences { campaignId, name?, steps: [{ delayDays, bodyHtml }] } */
export const createSequence = async (req, res) => {
  try {
    const campaignId = Number(req.body?.campaignId);
    const campaign = Number.isInteger(campaignId)
      ? await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true, userId: true, sendType: true } })
      : null;
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    if (campaign.userId !== req.user.id && !isAdminOrHr(req.user)) {
      return res.status(403).json({ success: false, message: "You can only automate your own campaigns" });
    }
    if (campaign.sendType === "followup") {
      return res.status(400).json({ success: false, message: "Choose the original campaign, not a follow-up" });
    }
    const { steps, error } = validateSteps(req.body.steps);
    if (error) return res.status(400).json({ success: false, message: error });

    const seq = await prisma.$transaction(async (tx) => {
      const created = await tx.followupSequence.create({
        data: {
          name: cleanStr(req.body.name, 120) || `${campaign.name} follow-ups`,
          campaignId: campaign.id,
          ownerId: campaign.userId,
          status: "draft",
        },
      });
      await tx.sequenceStep.createMany({ data: steps.map((s) => ({ ...s, sequenceId: created.id })) });
      return created;
    });
    res.status(201).json({ success: true, data: seq });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "This campaign already has a follow-up sequence" });
    }
    return serverError(res, "createSequence", err);
  }
};

/* PUT /api/automation/sequences/:id { name?, steps? } */
export const updateSequence = async (req, res) => {
  try {
    const { seq, editable, error } = await loadSequence(req, idParam(req));
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    if (!editable) return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can edit" });
    if (seq.status === "archived") return res.status(400).json({ success: false, message: "Archived sequences can't be edited" });

    let steps = null;
    if (req.body?.steps !== undefined) {
      const v = validateSteps(req.body.steps);
      if (v.error) return res.status(400).json({ success: false, message: v.error });
      steps = v.steps;
      // Steps already sent to someone can't be removed.
      const maxSent = await prisma.sequenceEnrollment.aggregate({ where: { sequenceId: seq.id }, _max: { stepsSent: true } });
      if ((maxSent._max?.stepsSent || 0) > steps.length) {
        return res.status(400).json({
          success: false,
          message: `${maxSent._max.stepsSent} step(s) have already been sent — keep at least that many`,
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      const name = cleanStr(req.body?.name, 120);
      if (name) await tx.followupSequence.update({ where: { id: seq.id }, data: { name } });
      if (steps) {
        await tx.sequenceStep.deleteMany({ where: { sequenceId: seq.id } });
        await tx.sequenceStep.createMany({ data: steps.map((s) => ({ ...s, sequenceId: seq.id })) });
        // People who had finished every step get the newly added steps,
        // each waiting the delay of THEIR next step from now.
        for (let k = 0; k < steps.length; k++) {
          await tx.sequenceEnrollment.updateMany({
            where: { sequenceId: seq.id, status: "completed", stepsSent: k },
            data: { status: "active", nextDueAt: new Date(Date.now() + steps[k].delayDays * 86_400_000) },
          });
        }
      }
    });
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "updateSequence", err);
  }
};

async function setStatus(req, res, status) {
  const { seq, editable, error } = await loadSequence(req, idParam(req));
  if (error) return res.status(error[0]).json({ success: false, message: error[1] });
  if (!editable) return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can change this" });
  if (seq.status === "archived") return res.status(400).json({ success: false, message: "This sequence is archived" });

  if (status === "active") {
    const steps = await prisma.sequenceStep.count({ where: { sequenceId: seq.id } });
    if (!steps) return res.status(400).json({ success: false, message: "Add at least one step first" });
  }
  const data = { status };
  if (status === "active" && !seq.activatedAt) data.activatedAt = new Date();
  await prisma.followupSequence.update({ where: { id: seq.id }, data });
  let stopped = 0;
  if (status === "archived") stopped = await stopAllEnrollments(seq.id, "Sequence archived");
  return res.json({ success: true, status, stopped });
}

export const activateSequence = async (req, res) => {
  try { return await setStatus(req, res, "active"); } catch (err) { return serverError(res, "activateSequence", err); }
};
export const pauseSequence = async (req, res) => {
  try { return await setStatus(req, res, "paused"); } catch (err) { return serverError(res, "pauseSequence", err); }
};
export const archiveSequence = async (req, res) => {
  try { return await setStatus(req, res, "archived"); } catch (err) { return serverError(res, "archiveSequence", err); }
};

/* GET /api/automation/sequences/:id/enrollments?status=&search=&page= */
export const listEnrollments = async (req, res) => {
  try {
    const { seq, error } = await loadSequence(req, idParam(req));
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 50, 1, 200);
    const where = { sequenceId: seq.id };
    if (["active", "replied", "bounced", "unsubscribed", "completed", "stopped"].includes(req.query.status)) {
      where.status = req.query.status;
    }
    const search = cleanStr(req.query.search, 100);
    if (search) where.email = { contains: search.toLowerCase() };
    const [rows, total] = await Promise.all([
      prisma.sequenceEnrollment.findMany({ where, orderBy: [{ nextDueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.sequenceEnrollment.count({ where }),
    ]);
    res.json({ success: true, data: rows, pagination: { page, pageSize, total } });
  } catch (err) {
    return serverError(res, "listEnrollments", err);
  }
};

/* POST /api/automation/enrollments/:id/stop */
export const stopEnrollment = async (req, res) => {
  try {
    const id = idParam(req);
    const row = id ? await prisma.sequenceEnrollment.findUnique({ where: { id } }) : null;
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const { editable } = await loadSequence(req, row.sequenceId);
    if (!editable) return res.status(403).json({ success: false, message: "Only the owner or Admin/HR can change this" });
    const r = await prisma.sequenceEnrollment.updateMany({
      where: { id, status: "active" },
      data: { status: "stopped", stoppedReason: `Stopped by ${req.user.name || req.user.email}`, nextDueAt: null },
    });
    res.json({ success: true, stopped: r.count });
  } catch (err) {
    return serverError(res, "stopEnrollment", err);
  }
};
