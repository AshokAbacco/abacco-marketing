// src/controllers/crm/tasks.controller.js
// Tasks, reminders, notifications and small lookups for the CRM screens.
import prisma from "../../prismaClient.js";
import { isAdminOrHr } from "../../middlewares/authMiddleware.js";
import {
  TASK_PRIORITIES,
  cleanStr,
  canEdit,
  attachUsers,
  displayName,
  logActivity,
  notify,
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

/** Assignee, creator, or Admin/HR may change a task. */
const canManageTask = (user, task) =>
  Boolean(user) && (task.assignedToId === user.id || task.createdById === user.id || isAdminOrHr(user));

/** Start and end of "today" in the caller's timezone offset (minutes, like Date#getTimezoneOffset). */
function dayBounds(tzOffsetMinutes) {
  const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0;
  const now = new Date();
  const local = new Date(now.getTime() - offset * 60_000);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() + offset * 60_000);
  return { now, start, end: new Date(start.getTime() + 86_400_000) };
}

async function decorateTasks(tasks, user) {
  if (!tasks.length) return [];
  const contactIds = [...new Set(tasks.map((t) => t.contactId).filter(Boolean))];
  const dealIds = [...new Set(tasks.map((t) => t.dealId).filter(Boolean))];
  const [users, contacts, deals] = await Promise.all([
    attachUsers(tasks, ["assignedToId", "createdById"]),
    contactIds.length
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, email: true, firstName: true, lastName: true, name: true },
        })
      : [],
    dealIds.length ? prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, title: true } }) : [],
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, { id: c.id, email: c.email, displayName: displayName(c) }]));
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const now = Date.now();
  return tasks.map((t) => ({
    ...t,
    assignedTo: users.get(t.assignedToId) || null,
    createdBy: t.createdById ? users.get(t.createdById) || null : null,
    contact: t.contactId ? contactById.get(t.contactId) || null : null,
    deal: t.dealId ? dealById.get(t.dealId) || null : null,
    overdue: t.status === "open" && t.dueAt ? new Date(t.dueAt).getTime() < now : false,
    canEdit: canManageTask(user, t),
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/crm/tasks
     ?view=open|overdue|today|upcoming|done   (default open)
     &assignee=me|all|<userId>                (all/other: Admin/HR only)
     &contactId= &dealId= &tz=<minutes>
═══════════════════════════════════════════════════════════════════════════ */
export const listTasks = async (req, res) => {
  try {
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 50, 1, 200);
    const view = String(req.query.view || "open");
    const { now, start, end } = dayBounds(Number(req.query.tz));
    const where = {};

    // Tasks on a specific contact/deal are visible to everyone (shared record).
    const scoped = req.query.contactId || req.query.dealId;
    if (req.query.contactId) where.contactId = Number(req.query.contactId);
    if (req.query.dealId) where.dealId = Number(req.query.dealId);

    const assignee = String(req.query.assignee || (scoped ? "all" : "me"));
    if (assignee === "me") where.assignedToId = req.user.id;
    else if (assignee !== "all") {
      if (assignee !== req.user.id && !isAdminOrHr(req.user)) {
        return res.status(403).json({ success: false, message: "You can only list your own tasks" });
      }
      where.assignedToId = assignee;
    } else if (!scoped && !isAdminOrHr(req.user)) {
      where.assignedToId = req.user.id;
    }

    let orderBy = [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }];
    switch (view) {
      case "done":
        where.status = "done";
        orderBy = [{ completedAt: "desc" }];
        break;
      case "overdue":
        where.status = "open";
        where.dueAt = { lt: now };
        break;
      case "today":
        where.status = "open";
        where.dueAt = { gte: start, lt: end };
        break;
      case "upcoming":
        where.status = "open";
        where.OR = [{ dueAt: { gte: end } }, { dueAt: null }];
        break;
      default:
        where.status = "open";
    }

    const [rows, total, counts] = await Promise.all([
      prisma.task.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.task.count({ where }),
      // Badge counts for "my tasks" tabs.
      scoped ? null : Promise.all([
        prisma.task.count({ where: { assignedToId: where.assignedToId, status: "open", dueAt: { lt: now } } }),
        prisma.task.count({ where: { assignedToId: where.assignedToId, status: "open", dueAt: { gte: start, lt: end } } }),
        prisma.task.count({ where: { assignedToId: where.assignedToId, status: "open" } }),
      ]),
    ]);

    res.json({
      success: true,
      data: await decorateTasks(rows, req.user),
      pagination: { page, pageSize, total },
      counts: counts ? { overdue: counts[0], today: counts[1], open: counts[2] } : undefined,
    });
  } catch (err) {
    return serverError(res, "listTasks", err);
  }
};

async function validateTaskBody(body, { partial }) {
  const data = {};
  if (!partial || body.title !== undefined) {
    const title = cleanStr(body.title, 200);
    if (!title) return { error: "Task title is required" };
    data.title = title;
  }
  if (body.description !== undefined) data.description = cleanStr(body.description, 5000);
  if (body.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(body.priority)) return { error: "priority must be low, normal or high" };
    data.priority = body.priority;
  }
  for (const key of ["dueAt", "remindAt"]) {
    if (body[key] === undefined) continue;
    const d = parseDateOrNull(body[key]);
    if (d === undefined) return { error: `Invalid ${key}` };
    data[key] = d;
  }
  for (const [key, model] of [["contactId", "contact"], ["dealId", "deal"]]) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === "") { data[key] = null; continue; }
    const n = Number(body[key]);
    if (!Number.isInteger(n)) return { error: `Invalid ${key}` };
    const row = await prisma[model].findUnique({ where: { id: n }, select: { id: true } });
    if (!row) return { error: `${model} not found` };
    data[key] = n;
  }
  if (body.assignedToId !== undefined) {
    const u = await prisma.user.findUnique({ where: { id: String(body.assignedToId) }, select: { id: true, isActive: true } });
    if (!u?.isActive) return { error: "Assignee not found" };
    data.assignedToId = u.id;
  }
  return { data };
}

/* POST /api/crm/tasks */
export const createTask = async (req, res) => {
  try {
    const { data, error } = await validateTaskBody(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ success: false, message: error });
    data.assignedToId = data.assignedToId || req.user.id;
    // Reminder defaults to the due time.
    if (data.remindAt === undefined && data.dueAt) data.remindAt = data.dueAt;
    if (data.dealId && data.contactId === undefined) {
      const deal = await prisma.deal.findUnique({ where: { id: data.dealId }, select: { contactId: true } });
      if (deal?.contactId) data.contactId = deal.contactId;
    }

    const task = await prisma.task.create({ data: { ...data, createdById: req.user.id } });
    if (task.assignedToId !== req.user.id) {
      await notify(task.assignedToId, {
        type: "task_assigned",
        title: `New task from ${req.user.name || req.user.email}: ${task.title}`,
        body: task.dueAt ? `Due ${new Date(task.dueAt).toISOString()}` : null,
        link: "/crm/tasks",
      });
    }
    const [decorated] = await decorateTasks([task], req.user);
    res.status(201).json({ success: true, data: decorated });
  } catch (err) {
    return serverError(res, "createTask", err);
  }
};

/* PUT /api/crm/tasks/:id */
export const updateTask = async (req, res) => {
  try {
    const id = idParam(req);
    const task = id ? await prisma.task.findUnique({ where: { id } }) : null;
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (!canManageTask(req.user, task)) {
      return res.status(403).json({ success: false, message: "You can't edit this task" });
    }
    const { data, error } = await validateTaskBody(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });

    // New time → the reminder fires again.
    if (data.remindAt !== undefined || data.dueAt !== undefined) {
      if (data.remindAt === undefined && data.dueAt !== undefined && (!task.remindAt || task.remindAt?.getTime?.() === task.dueAt?.getTime?.())) {
        data.remindAt = data.dueAt;
      }
      data.reminderSentAt = null;
    }

    const updated = await prisma.task.update({ where: { id }, data });
    if (data.assignedToId && data.assignedToId !== task.assignedToId && data.assignedToId !== req.user.id) {
      await notify(data.assignedToId, { type: "task_assigned", title: `Task assigned to you: ${updated.title}`, link: "/crm/tasks" });
    }
    const [decorated] = await decorateTasks([updated], req.user);
    res.json({ success: true, data: decorated });
  } catch (err) {
    return serverError(res, "updateTask", err);
  }
};

/* PATCH /api/crm/tasks/:id/complete { done: true|false } */
export const completeTask = async (req, res) => {
  try {
    const id = idParam(req);
    const task = id ? await prisma.task.findUnique({ where: { id } }) : null;
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (!canManageTask(req.user, task)) {
      return res.status(403).json({ success: false, message: "You can't change this task" });
    }
    const done = req.body?.done !== false;
    // Conditional update: two quick clicks don't log twice.
    const result = await prisma.task.updateMany({
      where: { id, status: done ? "open" : "done" },
      data: done ? { status: "done", completedAt: new Date() } : { status: "open", completedAt: null },
    });
    if (result.count && done && (task.contactId || task.dealId)) {
      await logActivity({
        type: "task_completed",
        title: `Task completed: ${task.title}`,
        contactId: task.contactId,
        dealId: task.dealId,
        userId: req.user.id,
      });
    }
    const fresh = await prisma.task.findUnique({ where: { id } });
    const [decorated] = await decorateTasks([fresh], req.user);
    res.json({ success: true, data: decorated });
  } catch (err) {
    return serverError(res, "completeTask", err);
  }
};

/* DELETE /api/crm/tasks/:id */
export const deleteTask = async (req, res) => {
  try {
    const id = idParam(req);
    const task = id ? await prisma.task.findUnique({ where: { id } }) : null;
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (!canManageTask(req.user, task)) {
      return res.status(403).json({ success: false, message: "You can't delete this task" });
    }
    await prisma.task.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    return serverError(res, "deleteTask", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════════════════════════════════════ */
export const listNotifications = async (req, res) => {
  try {
    const limit = intParam(req.query.limit, 20, 1, 100);
    const where = { userId: req.user.id };
    if (req.query.unread === "1") where.readAt = null;
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    res.set("Cache-Control", "private, no-store");
    res.json({ success: true, data: rows, unread });
  } catch (err) {
    return serverError(res, "listNotifications", err);
  }
};

/* POST /api/crm/notifications/read { ids: [..] } or { all: true } */
export const markNotificationsRead = async (req, res) => {
  try {
    const where = { userId: req.user.id, readAt: null };
    if (!req.body?.all) {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length) return res.status(400).json({ success: false, message: "ids or all is required" });
      where.id = { in: ids.slice(0, 500) };
    }
    const r = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
    res.json({ success: true, updated: r.count });
  } catch (err) {
    return serverError(res, "markNotificationsRead", err);
  }
};

/* GET /api/crm/users — active users for owner/assignee pickers */
export const listCrmUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
    res.set("Cache-Control", "private, max-age=60");
    res.json({ success: true, data: users.map((u) => ({ ...u, name: u.name || u.email })) });
  } catch (err) {
    return serverError(res, "listCrmUsers", err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   WORKER JOBS
═══════════════════════════════════════════════════════════════════════════ */

/** Send in-app reminders for tasks whose remindAt has passed. */
export async function runTaskReminders({ batch = 200 } = {}) {
  const due = await prisma.task.findMany({
    where: { status: "open", remindAt: { lte: new Date() }, reminderSentAt: null },
    orderBy: { remindAt: "asc" },
    take: batch,
    select: { id: true, title: true, dueAt: true, assignedToId: true, contactId: true },
  });
  let sent = 0;
  for (const t of due) {
    // Claim first so a second worker (or a retry) never double-notifies.
    const claimed = await prisma.task.updateMany({
      where: { id: t.id, reminderSentAt: null },
      data: { reminderSentAt: new Date() },
    });
    if (!claimed.count) continue;
    await notify(t.assignedToId, {
      type: "task_reminder",
      title: `Reminder: ${t.title}`,
      body: t.dueAt ? `Due ${new Date(t.dueAt).toISOString()}` : null,
      link: t.contactId ? `/crm/contacts/${t.contactId}` : "/crm/tasks",
    });
    sent++;
  }
  if (sent) console.log(`🔔 Sent ${sent} task reminder(s)`);
  return sent;
}

/** Delete read notifications older than N days. */
export async function purgeOldNotifications(days = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 60) {
  const r = await prisma.notification.deleteMany({
    where: { readAt: { not: null }, createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return r.count;
}
