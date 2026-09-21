// src/controllers/deliverability.controller.js
//
// Admin/HR API for the do-not-contact list, "remove me" review queue and
// sending-account health.

import prisma from "../prismaClient.js";
import {
  normalizeEmail,
  suppressEmail,
  unsuppressEmail,
  SUPPRESSION_REASONS,
  FEATURES,
} from "../services/suppression.service.js";
import {
  pauseAccount,
  resumeAccount,
} from "../services/inboundProcessor.service.js";
import {
  getSendingLimits,
  saveSendingLimits,
  validateSendingLimits,
  computeDailyCap,
  getSendingDayStart,
  invalidateCapCache,
} from "../services/sendingLimits.service.js";
import { checkSendingDomains } from "../services/domainAuth.service.js";
import { isAdminOrHr } from "../middlewares/authMiddleware.js";
import cache from "../utils/cache.js";

const MAX_IMPORT = 20_000;

const intParam = (v, fallback, min, max) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/* ── Summary ───────────────────────────────────────────────────────────── */
export const getSummary = async (req, res) => {
  try {
    const cached = cache.get("deliverability:summary");
    if (cached) return res.json({ success: true, data: cached });

    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const [byReason, pendingReviews, pausedAccounts, replies7d, bounces7d] =
      await Promise.all([
        prisma.suppressedEmail.groupBy({
          by: ["reason"],
          _count: { _all: true },
        }),
        prisma.replyEvent.count({ where: { reviewStatus: "pending" } }),
        prisma.emailAccount.count({
          where: { deleted: false, sendingPausedAt: { not: null } },
        }),
        prisma.replyEvent.count({ where: { receivedAt: { gte: since7d } } }),
        prisma.emailBounce.groupBy({
          by: ["type"],
          where: { createdAt: { gte: since7d } },
          _count: { _all: true },
        }),
      ]);

    const data = {
      features: FEATURES,
      suppressedTotal: byReason.reduce((s, r) => s + r._count._all, 0),
      suppressedByReason: Object.fromEntries(
        byReason.map((r) => [r.reason, r._count._all]),
      ),
      pendingReviews,
      pausedAccounts,
      replies7d,
      bounces7d: Object.fromEntries(
        bounces7d.map((b) => [b.type, b._count._all]),
      ),
      publicUrlConfigured: Boolean(process.env.PUBLIC_API_URL),
    };
    cache.set("deliverability:summary", data, 15);
    res.json({ success: true, data });
  } catch (err) {
    console.error("deliverability summary error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ── Suppression list ──────────────────────────────────────────────────── */
export const listSuppressions = async (req, res) => {
  try {
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 50, 1, 200);
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const reason = SUPPRESSION_REASONS.includes(req.query.reason)
      ? req.query.reason
      : null;

    const where = {
      ...(search ? { email: { contains: search } } : {}),
      ...(reason ? { reason } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.suppressedEmail.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.suppressedEmail.count({ where }),
    ]);

    res.json({
      success: true,
      data: rows,
      pagination: { page, pageSize, total },
    });
  } catch (err) {
    console.error("listSuppressions error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST { emails: "a@x.com, b@y.com" | string[], note?, reason?: "manual"|"import" } */
export const addSuppressions = async (req, res) => {
  try {
    const raw = req.body?.emails;
    const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/);
    if (list.length > MAX_IMPORT) {
      return res
        .status(400)
        .json({
          success: false,
          message: `At most ${MAX_IMPORT} addresses per request`,
        });
    }
    const reason = req.body?.reason === "import" ? "import" : "manual";
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

    const valid = [];
    const invalid = [];
    const seen = new Set();
    for (const item of list) {
      const trimmed = String(item || "").trim();
      if (!trimmed) continue;
      const e = normalizeEmail(trimmed);
      if (!e) {
        invalid.push(trimmed.slice(0, 100));
        continue;
      }
      if (!seen.has(e)) {
        seen.add(e);
        valid.push(e);
      }
    }
    if (!valid.length) {
      return res
        .status(400)
        .json({
          success: false,
          message: "No valid email addresses",
          invalid: invalid.slice(0, 50),
        });
    }

    let added = 0;
    for (const email of valid) {
      const r = await suppressEmail({
        email,
        reason,
        source: reason === "import" ? "import" : "admin",
        note,
        addedById: req.user.id,
      });
      if (r?.created) added++;
    }

    cache.del("deliverability:summary");
    res.json({
      success: true,
      added,
      alreadyListed: valid.length - added,
      invalidCount: invalid.length,
      invalid: invalid.slice(0, 50),
    });
  } catch (err) {
    console.error("addSuppressions error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const removeSuppression = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = Number.isInteger(id)
      ? await prisma.suppressedEmail.findUnique({
          where: { id },
          select: { email: true },
        })
      : null;
    if (!row)
      return res.status(404).json({ success: false, message: "Not found" });
    await unsuppressEmail(row.email);
    cache.del("deliverability:summary");
    res.json({ success: true });
  } catch (err) {
    console.error("removeSuppression error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const exportSuppressions = async (req, res) => {
  try {
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set(
      "Content-Disposition",
      `attachment; filename="suppression-list-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.write("email,reason,source,note,added_at\n");

    let lastId = 0;
    for (;;) {
      const rows = await prisma.suppressedEmail.findMany({
        where: { id: { gt: lastId } },
        orderBy: { id: "asc" },
        take: 2000,
      });
      if (!rows.length) break;
      lastId = rows[rows.length - 1].id;
      res.write(
        rows
          .map((r) =>
            [r.email, r.reason, r.source, r.note, r.createdAt.toISOString()]
              .map(csvCell)
              .join(","),
          )
          .join("\n") + "\n",
      );
    }
    res.end();
  } catch (err) {
    console.error("exportSuppressions error:", err);
    if (!res.headersSent)
      res.status(500).json({ success: false, message: "Server error" });
    else res.end();
  }
};

/* ── "Remove me" review queue ──────────────────────────────────────────── */
export const listReviews = async (req, res) => {
  try {
    const status = ["pending", "suppressed", "dismissed"].includes(
      req.query.status,
    )
      ? req.query.status
      : "pending";
    const page = intParam(req.query.page, 1, 1, 100_000);
    const pageSize = intParam(req.query.pageSize, 50, 1, 200);

    const [rows, total] = await Promise.all([
      prisma.replyEvent.findMany({
        where: { reviewStatus: status },
        orderBy: { receivedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          fromEmail: true,
          subject: true,
          snippet: true,
          receivedAt: true,
          accountId: true,
          campaignId: true,
          conversationId: true,
          reviewStatus: true,
          reviewedAt: true,
        },
      }),
      prisma.replyEvent.count({ where: { reviewStatus: status } }),
    ]);

    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const accounts = accountIds.length
      ? await prisma.emailAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailById = Object.fromEntries(accounts.map((a) => [a.id, a.email]));

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        accountEmail: emailById[r.accountId] || null,
      })),
      pagination: { page, pageSize, total },
    });
  } catch (err) {
    console.error("listReviews error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /reviews/:id { action: "suppress" | "dismiss" } */
export const resolveReview = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const action = req.body?.action;
    if (!["suppress", "dismiss"].includes(action)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "action must be suppress or dismiss",
        });
    }

    const event = Number.isInteger(id)
      ? await prisma.replyEvent.findUnique({ where: { id } })
      : null;
    if (!event || event.intent !== "unsubscribe_request") {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (action === "suppress") {
      await suppressEmail({
        email: event.email,
        reason: "reply_request",
        source: "reply",
        note: event.snippet,
        campaignId: event.campaignId,
        accountId: event.accountId,
        addedById: req.user.id,
      });
    }

    await prisma.replyEvent.update({
      where: { id },
      data: {
        reviewStatus: action === "suppress" ? "suppressed" : "dismissed",
        reviewedAt: new Date(),
        reviewedById: req.user.id,
      },
    });

    cache.del("deliverability:summary");
    res.json({ success: true });
  } catch (err) {
    console.error("resolveReview error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ── Sending-account health ────────────────────────────────────────────── */
export const listAccountHealth = async (req, res) => {
  try {
    const adminView = isAdminOrHr(req.user);
    const cacheKey = `deliverability:health:${adminView ? "all" : req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const now = Date.now();
    const since24 = new Date(now - 24 * 3_600_000);
    const since7d = new Date(now - 7 * 86_400_000);
    const ownerFilter = adminView ? null : req.user.id;

    const rows = await prisma.$queryRaw`
      SELECT a."id", a."email", a."provider", a."senderName",
             a."sendingPausedAt", a."sendingPausedReason", a."sendingPausedUntil",
             u."name" AS "ownerName", u."email" AS "ownerEmail",
             coalesce(s."sent24", 0)::int  AS "sent24",
             coalesce(s."sent7d", 0)::int  AS "sent7d",
             coalesce(b."hard24", 0)::int  AS "hard24",
             coalesce(b."soft24", 0)::int  AS "soft24",
             coalesce(b."block24", 0)::int AS "block24",
             coalesce(b."bad7d", 0)::int   AS "bad7d",
             coalesce(r."replies7d", 0)::int AS "replies7d",
             coalesce(t."count", 0)::int    AS "sentToday",
             a."dailyCap", a."warmupEnabled", a."warmupStartAt", a."warmupStartCap", a."warmupTarget"
      FROM "EmailAccount" a
      JOIN "User" u ON u."id" = a."userId"
      LEFT JOIN (
        SELECT "accountId",
               count(*) FILTER (WHERE "sentAt" >= ${since24}) AS "sent24",
               count(*) AS "sent7d"
        FROM "CampaignRecipient"
        WHERE "status" = 'sent' AND "sentAt" >= ${since7d}
        GROUP BY "accountId"
      ) s ON s."accountId" = a."id"
      LEFT JOIN (
        SELECT "accountId",
               count(*) FILTER (WHERE "type" = 'hard'  AND "createdAt" >= ${since24}) AS "hard24",
               count(*) FILTER (WHERE "type" = 'soft'  AND "createdAt" >= ${since24}) AS "soft24",
               count(*) FILTER (WHERE "type" = 'block' AND "createdAt" >= ${since24}) AS "block24",
               count(*) FILTER (WHERE "type" IN ('hard', 'block')) AS "bad7d"
        FROM "EmailBounce"
        WHERE "createdAt" >= ${since7d}
        GROUP BY "accountId"
      ) b ON b."accountId" = a."id"
      LEFT JOIN (
        SELECT "accountId", count(*) AS "replies7d"
        FROM "ReplyEvent"
        WHERE "receivedAt" >= ${since7d}
        GROUP BY "accountId"
      ) r ON r."accountId" = a."id"
      LEFT JOIN "AccountDailySend" t ON t."accountId" = a."id" AND t."day" = ${getSendingDayStart()}
      WHERE a."deleted" = false
        AND (${ownerFilter}::text IS NULL OR a."userId" = ${ownerFilter}::text)
      ORDER BY (a."sendingPausedAt" IS NULL), coalesce(b."bad7d", 0) DESC, a."email"
    `;

    const limits = await getSendingLimits();
    const data = rows.map((r) => {
      const { cap, source, warmupDay } = computeDailyCap(r, limits);
      const bounceRate7d = r.sent7d ? r.bad7d / r.sent7d : 0;
      const replyRate7d = r.sent7d ? r.replies7d / r.sent7d : 0;
      const status = r.sendingPausedAt
        ? "paused"
        : bounceRate7d >= 0.05 || r.block24 > 0
          ? "warning"
          : "healthy";
      return {
        ...r,
        bounceRate7d: Math.round(bounceRate7d * 1000) / 10,
        replyRate7d: Math.round(replyRate7d * 1000) / 10,
        dailyLimit: Number.isFinite(cap) ? cap : null,
        limitSource: source,
        warmupDay: warmupDay ?? null,
        capReached: Number.isFinite(cap) && r.sentToday >= cap,
        status,
      };
    });

    cache.set(cacheKey, data, 20);
    res.json({ success: true, data });
  } catch (err) {
    console.error("listAccountHealth error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

async function loadManageableAccount(req, id) {
  if (!Number.isInteger(id)) return null;
  const account = await prisma.emailAccount.findUnique({
    where: { id },
    select: { id: true, userId: true, deleted: true },
  });
  if (!account || account.deleted) return null;
  if (!isAdminOrHr(req.user) && account.userId !== req.user.id) return null;
  return account;
}

export const resumeSendingAccount = async (req, res) => {
  try {
    const account = await loadManageableAccount(req, Number(req.params.id));
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    await resumeAccount(account.id);
    cache.del("deliverability:summary");
    cache.del("deliverability:health:all");
    cache.del(`deliverability:health:${account.userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("resumeSendingAccount error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const pauseSendingAccount = async (req, res) => {
  try {
    const account = await loadManageableAccount(req, Number(req.params.id));
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    const reason = String(req.body?.reason || "Paused manually").slice(0, 200);
    const hours = intParam(req.body?.hours, 0, 0, 24 * 30);
    await pauseAccount(account.id, `${reason} (by ${req.user.email})`, hours);
    cache.del("deliverability:summary");
    cache.del("deliverability:health:all");
    cache.del(`deliverability:health:${account.userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("pauseSendingAccount error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 4 — daily caps, warm-up, trends and domain checks
═══════════════════════════════════════════════════════════════════════════ */

/** PUT /accounts/:id/limits { dailyCap, warmupEnabled, warmupStartCap, warmupTarget, restartWarmup } */
export const updateAccountLimits = async (req, res) => {
  try {
    const account = await loadManageableAccount(req, Number(req.params.id));
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    const body = req.body || {};
    const data = {};
    const intOrNull = (v, min, max, label) => {
      if (v === null || v === undefined || v === "") return { value: null };
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max)
        return { error: `${label} must be ${min}–${max}` };
      return { value: Math.round(n) };
    };

    if (body.dailyCap !== undefined) {
      const r = intOrNull(body.dailyCap, 1, 100_000, "Daily cap");
      if (r.error)
        return res.status(400).json({ success: false, message: r.error });
      data.dailyCap = r.value;
    }
    for (const [key, label] of [
      ["warmupStartCap", "Warm-up start"],
      ["warmupTarget", "Warm-up target"],
    ]) {
      if (body[key] === undefined) continue;
      const r = intOrNull(body[key], 1, 100_000, label);
      if (r.error)
        return res.status(400).json({ success: false, message: r.error });
      data[key] = r.value;
    }
    if (body.warmupEnabled !== undefined) {
      data.warmupEnabled = Boolean(body.warmupEnabled);
      const current = await prisma.emailAccount.findUnique({
        where: { id: account.id },
        select: { warmupEnabled: true, warmupStartAt: true },
      });
      // Starting (or restarting) warm-up resets day 1.
      if (
        data.warmupEnabled &&
        (!current.warmupEnabled || !current.warmupStartAt || body.restartWarmup)
      ) {
        data.warmupStartAt = new Date();
      }
    }
    if (
      data.warmupStartCap &&
      data.warmupTarget &&
      data.warmupTarget < data.warmupStartCap
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Warm-up target must be at least the start value",
        });
    }
    if (!Object.keys(data).length)
      return res
        .status(400)
        .json({ success: false, message: "Nothing to change" });

    const updated = await prisma.emailAccount.update({
      where: { id: account.id },
      data,
      select: {
        id: true,
        email: true,
        provider: true,
        dailyCap: true,
        warmupEnabled: true,
        warmupStartAt: true,
        warmupStartCap: true,
        warmupTarget: true,
      },
    });
    invalidateCapCache(account.id);
    cache.del("deliverability:health:all");
    cache.del(`deliverability:health:${account.userId}`);

    const limits = await getSendingLimits();
    const { cap, source, warmupDay } = computeDailyCap(updated, limits);
    res.json({
      success: true,
      data: {
        ...updated,
        dailyLimit: Number.isFinite(cap) ? cap : null,
        limitSource: source,
        warmupDay: warmupDay ?? null,
      },
    });
  } catch (err) {
    console.error("updateAccountLimits error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /settings/sending-limits */
export const getSendingLimitSettings = async (req, res) => {
  try {
    const [limits, providers] = await Promise.all([
      getSendingLimits(),
      prisma.emailAccount.groupBy({
        by: ["provider"],
        where: { deleted: false },
        _count: { _all: true },
      }),
    ]);
    res.json({
      success: true,
      data: limits,
      providersInUse: providers.map((p) => ({
        provider: p.provider || "unknown",
        accounts: p._count._all,
      })),
      canEdit: isAdminOrHr(req.user),
    });
  } catch (err) {
    console.error("getSendingLimitSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /settings/sending-limits (Admin/HR) */
export const saveSendingLimitSettings = async (req, res) => {
  try {
    const { value, error } = validateSendingLimits(req.body);
    if (error) return res.status(400).json({ success: false, message: error });
    await saveSendingLimits(value, req.user.id);
    cache.del("deliverability:health:all");
    res.json({ success: true, data: value });
  } catch (err) {
    console.error("saveSendingLimitSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /trends?days=14 — sends, bounces, replies and opt-outs per day. */
export const getTrends = async (req, res) => {
  try {
    const days = intParam(req.query.days, 14, 3, 90);
    const adminView = isAdminOrHr(req.user);
    const cacheKey = `deliverability:trends:${adminView ? "all" : req.user.id}:${days}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const since = new Date(Date.now() - days * 86_400_000);
    const ownerFilter = adminView ? null : req.user.id;

    const rows = await prisma.$queryRaw`
      WITH days AS (
        SELECT generate_series(date_trunc('day', ${since}::timestamp), date_trunc('day', NOW()), interval '1 day') AS day
      ),
      accounts AS (
        SELECT "id" FROM "EmailAccount"
        WHERE "deleted" = false AND (${ownerFilter}::text IS NULL OR "userId" = ${ownerFilter}::text)
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             coalesce(s.sent, 0)::int      AS sent,
             coalesce(s.replied, 0)::int   AS replied,
             coalesce(b.hard, 0)::int      AS hard,
             coalesce(b.soft, 0)::int      AS soft,
             coalesce(b.block, 0)::int     AS block,
             coalesce(r.replies, 0)::int   AS replies,
             coalesce(u.optouts, 0)::int   AS optouts
      FROM days d
      LEFT JOIN (
        SELECT date_trunc('day', "sentAt") AS day, count(*) AS sent,
               count(*) FILTER (WHERE "repliedAt" IS NOT NULL) AS replied
        FROM "CampaignRecipient"
        WHERE "status" = 'sent' AND "sentAt" >= ${since}
          AND "accountId" IN (SELECT "id" FROM accounts)
        GROUP BY 1
      ) s ON s.day = d.day
      LEFT JOIN (
        SELECT date_trunc('day', "createdAt") AS day,
               count(*) FILTER (WHERE "type" = 'hard') AS hard,
               count(*) FILTER (WHERE "type" = 'soft') AS soft,
               count(*) FILTER (WHERE "type" = 'block') AS block
        FROM "EmailBounce"
        WHERE "createdAt" >= ${since} AND "accountId" IN (SELECT "id" FROM accounts)
        GROUP BY 1
      ) b ON b.day = d.day
      LEFT JOIN (
        SELECT date_trunc('day', "receivedAt") AS day, count(*) AS replies
        FROM "ReplyEvent"
        WHERE "receivedAt" >= ${since} AND "accountId" IN (SELECT "id" FROM accounts)
        GROUP BY 1
      ) r ON r.day = d.day
      LEFT JOIN (
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS optouts
        FROM "SuppressedEmail"
        WHERE "createdAt" >= ${since} AND "reason" IN ('unsubscribe', 'reply_request')
          AND (${ownerFilter}::text IS NULL OR "accountId" IN (SELECT "id" FROM accounts))
        GROUP BY 1
      ) u ON u.day = d.day
      ORDER BY d.day
    `;

    const totals = rows.reduce(
      (acc, r) => ({
        sent: acc.sent + r.sent,
        replies: acc.replies + r.replies,
        bounces: acc.bounces + r.hard + r.soft + r.block,
        hardBounces: acc.hardBounces + r.hard,
        optouts: acc.optouts + r.optouts,
      }),
      { sent: 0, replies: 0, bounces: 0, hardBounces: 0, optouts: 0 },
    );
    const pct = (n) =>
      totals.sent ? Math.round((n / totals.sent) * 1000) / 10 : 0;

    const data = {
      days: rows,
      totals: {
        ...totals,
        replyRate: pct(totals.replies),
        bounceRate: pct(totals.bounces),
        hardBounceRate: pct(totals.hardBounces),
        optoutRate: pct(totals.optouts),
      },
      scope: adminView ? "company" : "mine",
    };
    cache.set(cacheKey, data, 120);
    res.json({ success: true, data });
  } catch (err) {
    console.error("getTrends error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /domains?refresh=1 — SPF / DKIM / DMARC for each sending domain. */
export const getDomainAuth = async (req, res) => {
  try {
    const adminView = isAdminOrHr(req.user);
    const data = await checkSendingDomains({
      refresh: req.query.refresh === "1",
      userId: adminView ? null : req.user.id,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getDomainAuth error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not check DNS records" });
  }
};
