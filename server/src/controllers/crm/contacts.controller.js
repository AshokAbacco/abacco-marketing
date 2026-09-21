// src/controllers/crm/contacts.controller.js
import prisma from "../../prismaClient.js";
import { isAdminOrHr } from "../../middlewares/authMiddleware.js";
import {
  LIFECYCLES,
  ACTIVITY_TYPES_MANUAL,
  cleanStr,
  normalizeEmail,
  splitName,
  displayName,
  canEdit,
  attachUsers,
  logActivity,
  notify,
  ensureContact,
  toMoney,
  parseDateOrNull,
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

async function activeUserExists(id) {
  if (!id) return false;
  const u = await prisma.user.findUnique({
    where: { id },
    select: { isActive: true },
  });
  return Boolean(u?.isActive);
}

/** Validated contact fields from a request body (only keys that were sent). */
function contactFieldsFromBody(body) {
  const data = {};
  const str = (key, max) => {
    if (body[key] !== undefined) data[key] = cleanStr(body[key], max);
  };
  str("firstName", 100);
  str("lastName", 100);
  str("phone", 50);
  str("jobTitle", 150);
  str("country", 100);
  str("website", 300);
  str("linkedin", 300);
  if (body.category !== undefined)
    data.category = cleanStr(body.category, 50)?.toLowerCase() || null;
  if (body.lifecycle !== undefined) {
    if (!LIFECYCLES.includes(body.lifecycle))
      return { error: `lifecycle must be one of ${LIFECYCLES.join(", ")}` };
    data.lifecycle = body.lifecycle;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: "tags must be an array" };
    data.tags = [
      ...new Set(body.tags.map((t) => cleanStr(t, 40)).filter(Boolean)),
    ].slice(0, 30);
  }
  if (body.companyId !== undefined) {
    if (body.companyId === null || body.companyId === "") data.companyId = null;
    else {
      const cid = Number(body.companyId);
      if (!Number.isInteger(cid) || cid <= 0)
        return { error: "Invalid companyId" };
      data.companyId = cid;
    }
  }
  if (data.firstName !== undefined || data.lastName !== undefined) {
    const name = [data.firstName, data.lastName].filter(Boolean).join(" ");
    data.name = name || null;
  }
  return { data };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIST  GET /api/crm/contacts
═══════════════════════════════════════════════════════════════════════════ */
export const listContacts = async (req, res) => {
  try {
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 25, 1, 100);
    const search = cleanStr(req.query.search, 100);
    const where = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { company: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    // FIX: previously a non-admin with no `ownerId` filter saw every user's
    // contacts (the client's default "All owners" filter sends nothing).
    // Non-admins are now always restricted to their own records; only
    // Admin/HR may request another owner's data or everyone's.
    if (!isAdminOrHr(req.user)) {
      where.ownerId = req.user.id;
    } else if (req.query.ownerId === "me") {
      where.ownerId = req.user.id;
    } else if (req.query.ownerId) {
      where.ownerId = String(req.query.ownerId);
    }

    if (LIFECYCLES.includes(req.query.lifecycle))
      where.lifecycle = req.query.lifecycle;
    if (req.query.category)
      where.category = String(req.query.category).toLowerCase();
    if (req.query.tag) where.tags = { has: String(req.query.tag) };
    if (req.query.companyId) {
      const cid = Number(req.query.companyId);
      if (Number.isInteger(cid)) where.companyId = cid;
    }

    const orderBy =
      req.query.sort === "name"
        ? [{ name: "asc" }, { email: "asc" }]
        : req.query.sort === "lastActivity"
          ? [
              { lastActivityAt: { sort: "desc", nulls: "last" } },
              { id: "desc" },
            ]
          : [{ updatedAt: "desc" }, { id: "desc" }];

    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          name: true,
          phone: true,
          jobTitle: true,
          country: true,
          category: true,
          lifecycle: true,
          tags: true,
          source: true,
          ownerId: true,
          companyId: true,
          lastActivityAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.contact.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const companyIds = [
      ...new Set(rows.map((r) => r.companyId).filter(Boolean)),
    ];
    const [users, companies, openDeals, suppressed] = await Promise.all([
      attachUsers(rows),
      companyIds.length
        ? prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true, name: true },
          })
        : [],
      ids.length
        ? prisma.deal.groupBy({
            by: ["contactId"],
            where: { contactId: { in: ids }, status: "open" },
            _count: { _all: true },
          })
        : [],
      rows.length
        ? prisma.suppressedEmail.findMany({
            where: { email: { in: rows.map((r) => r.email) } },
            select: { email: true },
          })
        : [],
    ]);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const dealsById = new Map(
      openDeals.map((d) => [d.contactId, d._count._all]),
    );
    const suppressedSet = new Set(suppressed.map((s) => s.email));

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        displayName: displayName(r),
        owner: users.get(r.ownerId) || null,
        company: r.companyId ? companyById.get(r.companyId) || null : null,
        openDeals: dealsById.get(r.id) || 0,
        doNotContact: suppressedSet.has(r.email),
        canEdit: canEdit(req.user, r.ownerId),
      })),
      pagination: { page, pageSize, total },
    });
  } catch (err) {
    return serverError(res, "listContacts", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   DETAIL  GET /api/crm/contacts/:id
═══════════════════════════════════════════════════════════════════════════ */
export const getContact = async (req, res) => {
  try {
    const id = idParam(req);
    const contact = id
      ? await prisma.contact.findUnique({ where: { id } })
      : null;
    if (!contact)
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });

    // FIX: a non-admin could previously fetch ANY contact by id — the list
    // page filtered results, but the detail route had no ownership check at
    // all. Block non-owners (unless Admin/HR) the same way edits already do.
    if (!canEdit(req.user, contact.ownerId)) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }

    const [
      company,
      deals,
      tasks,
      leads,
      suppression,
      sentCount,
      replyCount,
      lastReply,
    ] = await Promise.all([
      contact.companyId
        ? prisma.company.findUnique({
            where: { id: contact.companyId },
            select: { id: true, name: true, domain: true, website: true },
          })
        : null,
      prisma.deal.findMany({
        where: { contactId: id },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 50,
      }),
      prisma.task.findMany({
        where: { contactId: id, status: "open" },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: 50,
      }),
      prisma.lead.findMany({
        where: { contactId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, subject: true, leadType: true, createdAt: true },
      }),
      prisma.suppressedEmail.findUnique({
        where: { email: contact.email },
        select: { reason: true, createdAt: true },
      }),
      prisma.campaignRecipient.count({
        where: { email: contact.email, status: "sent" },
      }),
      prisma.replyEvent.count({ where: { email: contact.email } }),
      prisma.replyEvent.findFirst({
        where: { email: contact.email },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, snippet: true },
      }),
    ]);

    const stageIds = [...new Set(deals.map((d) => d.stageId))];
    const stages = stageIds.length
      ? await prisma.pipelineStage.findMany({ where: { id: { in: stageIds } } })
      : [];
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const users = await attachUsers(
      [contact, ...deals, ...tasks],
      ["ownerId", "assignedToId"],
    );

    res.json({
      success: true,
      data: {
        ...contact,
        displayName: displayName(contact),
        owner: users.get(contact.ownerId) || null,
        company,
        canEdit: canEdit(req.user, contact.ownerId),
        doNotContact: suppression
          ? { reason: suppression.reason, since: suppression.createdAt }
          : null,
        engagement: {
          emailsSent: sentCount,
          replies: replyCount,
          lastReplyAt: lastReply?.receivedAt || null,
          lastReplySnippet: lastReply?.snippet || null,
        },
        deals: deals.map((d) => ({
          ...d,
          amount: toMoney(d.amount),
          stage: stageById.get(d.stageId) || null,
          owner: users.get(d.ownerId) || null,
        })),
        tasks: tasks.map((t) => ({
          ...t,
          assignedTo: users.get(t.assignedToId) || null,
        })),
        leads,
      },
    });
  } catch (err) {
    return serverError(res, "getContact", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   TIMELINE  GET /api/crm/contacts/:id/timeline?before=ISO&limit=30
   Merges manual activities, campaign sends, replies, bounces and opt-out.
═══════════════════════════════════════════════════════════════════════════ */
export const getContactTimeline = async (req, res) => {
  try {
    const id = idParam(req);
    const contact = id
      ? await prisma.contact.findUnique({
          where: { id },
          select: { id: true, email: true, ownerId: true },
        })
      : null;
    if (!contact)
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });

    // FIX: same ownership check as getContact — the timeline leaked another
    // owner's contact activity even when the contact record itself was
    // hidden from lists.
    if (!canEdit(req.user, contact.ownerId)) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }

    const limit = intParam(req.query.limit, 30, 1, 100);
    const beforeParsed = parseDateOrNull(req.query.before);
    const before = beforeParsed || new Date(Date.now() + 60_000);
    const email = contact.email;

    const [activities, sends, replies, bounces, suppression] =
      await Promise.all([
        prisma.activity.findMany({
          where: { contactId: id, occurredAt: { lt: before } },
          orderBy: { occurredAt: "desc" },
          take: limit,
        }),
        prisma.campaignRecipient.findMany({
          where: { email, status: "sent", sentAt: { lt: before } },
          orderBy: { sentAt: "desc" },
          take: limit,
          select: {
            id: true,
            campaignId: true,
            sentAt: true,
            sentSubject: true,
            sentFromEmail: true,
            repliedAt: true,
            bouncedAt: true,
            bounceType: true,
          },
        }),
        prisma.replyEvent.findMany({
          where: { email, receivedAt: { lt: before } },
          orderBy: { receivedAt: "desc" },
          take: limit,
          select: {
            id: true,
            receivedAt: true,
            subject: true,
            snippet: true,
            intent: true,
            conversationId: true,
            accountId: true,
            campaignId: true,
            fromEmail: true,
            category: true,
          },
        }),
        prisma.emailBounce.findMany({
          where: { email, createdAt: { lt: before } },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            createdAt: true,
            type: true,
            statusCode: true,
            diagnostic: true,
            campaignId: true,
          },
        }),
        prisma.suppressedEmail.findUnique({ where: { email } }),
      ]);

    const campaignIds = [
      ...new Set(
        [...sends, ...replies, ...bounces]
          .map((x) => x.campaignId)
          .filter(Boolean),
      ),
    ];
    const [campaigns, users] = await Promise.all([
      campaignIds.length
        ? prisma.campaign.findMany({
            where: { id: { in: campaignIds } },
            select: { id: true, name: true, sendType: true },
          })
        : [],
      attachUsers(activities, ["userId"]),
    ]);
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));

    const items = [
      ...activities.map((a) => ({
        key: `a${a.id}`,
        kind: "activity",
        id: a.id,
        type: a.type,
        at: a.occurredAt,
        title: a.title,
        body: a.body,
        meta: a.meta,
        dealId: a.dealId,
        user: a.userId ? users.get(a.userId) || null : null,
        canDelete:
          ACTIVITY_TYPES_MANUAL.includes(a.type) &&
          (a.userId === req.user.id || isAdminOrHr(req.user)),
      })),
      ...sends.map((s) => ({
        key: `s${s.id}`,
        kind: "email_sent",
        at: s.sentAt,
        title: s.sentSubject || "(no subject)",
        from: s.sentFromEmail,
        campaign: campaignById.get(s.campaignId) || { id: s.campaignId },
        replied: Boolean(s.repliedAt),
        bounced: s.bounceType || null,
      })),
      ...replies.map((r) => ({
        key: `r${r.id}`,
        kind:
          r.intent === "unsubscribe_request"
            ? "removal_request"
            : "email_reply",
        at: r.receivedAt,
        title: r.subject,
        body: r.snippet,
        conversationId: r.conversationId,
        accountId: r.accountId,
        category: r.category,
        campaign: r.campaignId
          ? campaignById.get(r.campaignId) || { id: r.campaignId }
          : null,
      })),
      ...bounces.map((b) => ({
        key: `b${b.id}`,
        kind: "bounce",
        at: b.createdAt,
        title: `${b.type} bounce${b.statusCode ? ` (${b.statusCode})` : ""}`,
        body: b.diagnostic,
        campaign: b.campaignId
          ? campaignById.get(b.campaignId) || { id: b.campaignId }
          : null,
      })),
    ];
    if (suppression && suppression.createdAt < before) {
      items.push({
        key: `u${suppression.id}`,
        kind: "suppressed",
        at: suppression.createdAt,
        title: `Added to do-not-contact list (${suppression.reason.replace(/_/g, " ")})`,
        body: suppression.note,
      });
    }

    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    const page = items.slice(0, limit);
    const hasMore =
      items.length > limit ||
      [activities, sends, replies, bounces].some((l) => l.length === limit);

    res.json({
      success: true,
      data: page,
      nextBefore:
        hasMore && page.length
          ? new Date(page[page.length - 1].at).toISOString()
          : null,
    });
  } catch (err) {
    return serverError(res, "getContactTimeline", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE  POST /api/crm/contacts
═══════════════════════════════════════════════════════════════════════════ */
export const createContact = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "A valid email is required" });

    const existing = await prisma.contact.findUnique({
      where: { email },
      select: { id: true, ownerId: true },
    });
    if (existing) {
      const users = await attachUsers([existing]);
      return res.status(409).json({
        success: false,
        message: `This contact already exists (owner: ${users.get(existing.ownerId)?.name || "another user"})`,
        contactId: existing.id,
      });
    }

    const { data, error } = contactFieldsFromBody(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });

    let ownerId = req.user.id;
    if (req.body.ownerId && req.body.ownerId !== req.user.id) {
      if (!isAdminOrHr(req.user)) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Only Admin/HR can create contacts for someone else",
          });
      }
      if (!(await activeUserExists(req.body.ownerId))) {
        return res
          .status(400)
          .json({ success: false, message: "Owner not found" });
      }
      ownerId = req.body.ownerId;
    }

    if (data.companyId) {
      const exists = await prisma.company.findUnique({
        where: { id: data.companyId },
        select: { id: true },
      });
      if (!exists)
        return res
          .status(400)
          .json({ success: false, message: "Company not found" });
    }

    const nameFromBody = cleanStr(req.body.name, 200);
    const result = await ensureContact({
      email,
      ownerId,
      source: "manual",
      name: data.name || nameFromBody,
      createdById: req.user.id,
      linkCompany: data.companyId === undefined,
    });
    if (!result)
      return res
        .status(400)
        .json({ success: false, message: "Could not create contact" });

    const updateData = { ...data };
    if (!updateData.firstName && !updateData.lastName && nameFromBody)
      Object.assign(updateData, splitName(nameFromBody), {
        name: nameFromBody,
      });
    const contact = Object.keys(updateData).length
      ? await prisma.contact.update({
          where: { id: result.contact.id },
          data: updateData,
        })
      : result.contact;

    await logActivity({
      type: "created",
      title: "Contact created",
      contactId: contact.id,
      userId: req.user.id,
    });
    if (ownerId !== req.user.id) {
      await notify(ownerId, {
        type: "contact_assigned",
        title: `New contact assigned: ${displayName(contact)}`,
        link: `/crm/contacts/${contact.id}`,
      });
    }

    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    return serverError(res, "createContact", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE  PUT /api/crm/contacts/:id
═══════════════════════════════════════════════════════════════════════════ */
export const updateContact = async (req, res) => {
  try {
    const id = idParam(req);
    const contact = id
      ? await prisma.contact.findUnique({ where: { id } })
      : null;
    if (!contact)
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    if (!canEdit(req.user, contact.ownerId)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only the owner or Admin/HR can edit this contact",
        });
    }

    const { data, error } = contactFieldsFromBody(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });

    if (data.companyId) {
      const exists = await prisma.company.findUnique({
        where: { id: data.companyId },
        select: { id: true },
      });
      if (!exists)
        return res
          .status(400)
          .json({ success: false, message: "Company not found" });
    }

    let newOwner = null;
    if (
      req.body.ownerId !== undefined &&
      req.body.ownerId !== contact.ownerId
    ) {
      if (!(await activeUserExists(req.body.ownerId))) {
        return res
          .status(400)
          .json({ success: false, message: "Owner not found" });
      }
      data.ownerId = req.body.ownerId;
      newOwner = req.body.ownerId;
    }

    const updated = await prisma.contact.update({ where: { id }, data });

    if (data.lifecycle && data.lifecycle !== contact.lifecycle) {
      await logActivity({
        type: "status_change",
        title: `Lifecycle: ${contact.lifecycle} → ${data.lifecycle}`,
        meta: { from: contact.lifecycle, to: data.lifecycle },
        contactId: id,
        userId: req.user.id,
      });
    }
    if (newOwner) {
      const users = await attachUsers([
        { ownerId: contact.ownerId },
        { ownerId: newOwner },
      ]);
      await logActivity({
        type: "owner_change",
        title: `Owner: ${users.get(contact.ownerId)?.name || "—"} → ${users.get(newOwner)?.name || "—"}`,
        contactId: id,
        userId: req.user.id,
      });
      if (newOwner !== req.user.id) {
        await notify(newOwner, {
          type: "contact_assigned",
          title: `Contact assigned to you: ${displayName(updated)}`,
          link: `/crm/contacts/${id}`,
        });
      }
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    return serverError(res, "updateContact", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE  DELETE /api/crm/contacts/:id
═══════════════════════════════════════════════════════════════════════════ */
export const deleteContact = async (req, res) => {
  try {
    const id = idParam(req);
    const contact = id
      ? await prisma.contact.findUnique({
          where: { id },
          select: { id: true, ownerId: true },
        })
      : null;
    if (!contact)
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    if (!canEdit(req.user, contact.ownerId)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only the owner or Admin/HR can delete this contact",
        });
    }
    // Activities and tasks cascade; deals and leads keep existing, unlinked.
    await prisma.contact.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "deleteContact", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   NOTES / CALLS / MEETINGS
   POST   /api/crm/activities         { type, title?, body, contactId?, dealId?, companyId?, occurredAt? }
   DELETE /api/crm/activities/:id     (author or Admin/HR; manual entries only)
   Anyone may add notes — the timeline is shared.
═══════════════════════════════════════════════════════════════════════════ */
export const createActivity = async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!ACTIVITY_TYPES_MANUAL.includes(type)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `type must be one of ${ACTIVITY_TYPES_MANUAL.join(", ")}`,
        });
    }
    const body = cleanStr(req.body.body, 20_000);
    const title = cleanStr(req.body.title, 300);
    if (!body && !title)
      return res
        .status(400)
        .json({ success: false, message: "Write something first" });

    const occurredAt = parseDateOrNull(req.body.occurredAt);
    if (occurredAt === undefined)
      return res.status(400).json({ success: false, message: "Invalid date" });

    const ids = {};
    for (const [key, model] of [
      ["contactId", "contact"],
      ["dealId", "deal"],
      ["companyId", "company"],
    ]) {
      if (
        req.body[key] === undefined ||
        req.body[key] === null ||
        req.body[key] === ""
      )
        continue;
      const n = Number(req.body[key]);
      if (!Number.isInteger(n))
        return res
          .status(400)
          .json({ success: false, message: `Invalid ${key}` });
      const row = await prisma[model].findUnique({
        where: { id: n },
        select: { id: true },
      });
      if (!row)
        return res
          .status(404)
          .json({ success: false, message: `${model} not found` });
      ids[key] = n;
    }
    if (!Object.keys(ids).length) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Attach the note to a contact, deal or company",
        });
    }
    // A note on a deal also shows on its contact's timeline.
    if (ids.dealId && !ids.contactId) {
      const deal = await prisma.deal.findUnique({
        where: { id: ids.dealId },
        select: { contactId: true },
      });
      if (deal?.contactId) ids.contactId = deal.contactId;
    }

    const activity = await logActivity({
      type,
      title,
      body,
      occurredAt: occurredAt || new Date(),
      userId: req.user.id,
      ...ids,
    });
    res.status(201).json({ success: true, data: activity });
  } catch (err) {
    return serverError(res, "createActivity", err);
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const id = idParam(req);
    const activity = id
      ? await prisma.activity.findUnique({ where: { id } })
      : null;
    if (!activity)
      return res.status(404).json({ success: false, message: "Not found" });
    if (!ACTIVITY_TYPES_MANUAL.includes(activity.type)) {
      return res
        .status(400)
        .json({ success: false, message: "System entries can't be deleted" });
    }
    if (activity.userId !== req.user.id && !isAdminOrHr(req.user)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only the author or Admin/HR can delete this",
        });
    }
    await prisma.activity.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "deleteActivity", err);
  }
};