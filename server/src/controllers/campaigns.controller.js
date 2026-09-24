// campaigns.controller.js
//
// API-side campaign endpoints.
//
// IMPORTANT: this process never sends email. Endpoints that start a
// campaign only set status = "sending"; worker.js picks it up within
// WORKER_RESUME_TICK_MS (default 10 s). Sending used to run here too,
// which put long-running send loops on the API's connection pool.

import prisma from "../prismaClient.js";
import {
  getDailyCount,
  DAILY_LIMIT,
  DEFAULT_HOURLY_LIMIT,
  PROVIDER_HOURLY_LIMITS,
  getDefaultHourlyLimit,
  resolveOriginalCampaignId,
} from "../services/campaignMailer.service.js";
import { buildCampaignStatus } from "../services/campaignStatus.service.js";
import { normalizeEmail } from "../services/suppression.service.js";
import cache, { getOrSet, delByPrefix } from "../utils/cache.js";
import { isAdminOrHr } from "../middlewares/authMiddleware.js";

const RECIPIENT_INSERT_CHUNK = 5_000;

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — invalidate dashboard cache
───────────────────────────────────────────────────────────────────────── */
const invalidateDashboardCache = (userId) => {
  delByPrefix(`dashboard:${userId}:`);
  delByPrefix(`progress:${userId}:`);
  // Busy accounts are global (any user's sending campaign locks accounts).
  cache.del("busyAccounts");
  cache.del(`dailyLimit:${userId}`);
  cache.del(`allCampaigns:${userId}`);
  cache.del(`campaignNames:${userId}`);
  cache.del(`appDashboard:${userId}`);
  // Keys are forFollowup:{user}:{level}:{offset}:{limit}. The old code
  // deleted `forFollowup:{user}:{level}`, which never matched anything.
  delByPrefix(`forFollowup:${userId}:`);
};

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — load a campaign the caller may manage (owner, or Admin/HR).
   Several endpoints previously let any logged-in user act on any campaign.
───────────────────────────────────────────────────────────────────────── */
async function findManageableCampaign(req, campaignId, select) {
  if (!Number.isInteger(campaignId) || campaignId <= 0) return null;
  const where = isAdminOrHr(req.user)
    ? { id: campaignId }
    : { id: campaignId, userId: req.user.id };
  return prisma.campaign.findFirst({ where, select });
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — mailboxes that still have emails to send in a "sending" campaign.

   A mailbox is BUSY only while it still has work left:
     • normal campaign: every mailbox of the campaign keeps sending from the
       shared queue, so all its mailboxes are busy until the campaign has no
       pending / in-flight recipients left;
     • follow-up: rows are tied to one mailbox, so a mailbox is busy only
       while IT still has pending / in-flight rows.
   As soon as a mailbox's part is sent, it is free for a new campaign.
───────────────────────────────────────────────────────────────────────── */
async function getBusyAccounts() {
  const loadAll = async () => {
    const sending = await prisma.campaign.findMany({
      where: { status: "sending" },
      select: { id: true, name: true, sendType: true, fromAccountIds: true },
    });
    if (!sending.length) return [];

    const rows = await prisma.$queryRaw`
      SELECT r."campaignId", r."accountId", count(*)::int AS remaining
      FROM "CampaignRecipient" r
      WHERE r."campaignId" = ANY(${sending.map((c) => c.id)}::int[])
        AND r."status" IN ('pending', 'processing')
      GROUP BY r."campaignId", r."accountId"
    `;

    const out = []; // { accountId, campaignId, campaignName, remaining }
    for (const c of sending) {
      const mine = rows.filter((r) => r.campaignId === c.id);
      const total = mine.reduce((sum, r) => sum + r.remaining, 0);
      if (!total) continue; // nothing left → no mailbox is busy with it

      if (c.sendType === "followup") {
        for (const r of mine) {
          if (r.accountId == null) continue;
          out.push({
            accountId: Number(r.accountId),
            campaignId: c.id,
            campaignName: c.name,
            remaining: r.remaining,
          });
        }
      } else {
        const ids = new Set(
          mine
            .map((r) => r.accountId)
            .filter((x) => x != null)
            .map(Number),
        );
        try {
          JSON.parse(c.fromAccountIds || "[]").forEach((id) =>
            ids.add(Number(id)),
          );
        } catch {
          /* malformed */
        }
        for (const id of ids)
          out.push({
            accountId: id,
            campaignId: c.id,
            campaignName: c.name,
            remaining: total,
          });
      }
    }
    return out;
  };
  return getOrSet("busyAccounts", 5, loadAll);
}

async function getBusyAccountIds({ excludeCampaignId = null } = {}) {
  const list = await getBusyAccounts();
  return new Set(
    list
      .filter((b) => b.campaignId !== excludeCampaignId)
      .map((b) => b.accountId),
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — shared daily-limit + window pre-check
   Returns null if all clear, or { status, body } error object if blocked.
───────────────────────────────────────────────────────────────────────── */
async function checkGlobalSendingRules(userId) {
  const sentToday = await getDailyCount(userId, { fresh: true });

  if (sentToday >= DAILY_LIMIT) {
    return {
      status: 429,
      body: {
        success: false,
        message: `Daily sending limit reached (${sentToday}/${DAILY_LIMIT}).`,
        dailySent: sentToday,
        dailyLimit: DAILY_LIMIT,
      },
    };
  }

  // if (!isWithinSendingWindow()) {
  //   const waitMs  = msUntilNextWindow();
  //   const waitMin = Math.ceil(waitMs / 60_000);
  //   return {
  //     status: 403,
  //     body: {
  //       success:    false,
  //       message:    `Emails can only be sent between 5:00 PM and 5:00 AM. Sending will resume automatically at the next 5:00 PM (in ~${waitMin} min).`,
  //       dailySent:  sentToday,
  //       dailyLimit: DAILY_LIMIT,
  //       resetsIn:   waitMs,
  //     },
  //   };
  // }

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — per-campaign status + engagement counts in ONE query.
   Returns { [campaignId]: { total, sent, pending, processing, failed,
             skipped, replied, bounced, unsubscribed, lastSentAt } }
───────────────────────────────────────────────────────────────────────── */
const EMPTY_COUNTS = Object.freeze({
  total: 0,
  sent: 0,
  pending: 0,
  processing: 0,
  failed: 0,
  skipped: 0,
  replied: 0,
  bounced: 0,
  unsubscribed: 0,
  lastSentAt: null,
});

async function getRecipientCounts(campaignIds) {
  if (!campaignIds.length) return {};

  const rows = await prisma.$queryRaw`
    SELECT "campaignId",
           count(*)::int                                               AS total,
           count(*) FILTER (WHERE "status" = 'sent')::int              AS sent,
           count(*) FILTER (WHERE "status" = 'pending')::int           AS pending,
           count(*) FILTER (WHERE "status" = 'processing')::int        AS processing,
           count(*) FILTER (WHERE "status" = 'failed')::int            AS failed,
           count(*) FILTER (WHERE "status" = 'skipped')::int           AS skipped,
           count(*) FILTER (WHERE "repliedAt" IS NOT NULL)::int        AS replied,
           count(*) FILTER (WHERE "bouncedAt" IS NOT NULL)::int        AS bounced,
           count(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL)::int   AS unsubscribed,
           max("sentAt") FILTER (WHERE "status" = 'sent')              AS "lastSentAt"
    FROM "CampaignRecipient"
    WHERE "campaignId" = ANY(${campaignIds}::int[])
    GROUP BY "campaignId"
  `;

  const map = {};
  for (const id of campaignIds) map[id] = { ...EMPTY_COUNTS };
  for (const r of rows) map[r.campaignId] = { ...EMPTY_COUNTS, ...r };
  return map;
}

/** Fields added to every campaign row in list responses. */
function countFields(k) {
  return {
    recipientCount: k.total,
    sentCount: k.sent,
    pendingCount: k.pending + k.processing,
    failedCount: k.failed,
    skippedCount: k.skipped,
    repliedCount: k.replied,
    bouncedCount: k.bounced,
    unsubscribedCount: k.unsubscribed,
    replyRate: k.sent ? Math.round((k.replied / k.sent) * 1000) / 10 : 0,
    lastSentAt: k.lastSentAt,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — per-provider hourly send limits (shared by progress + create)
───────────────────────────────────────────────────────────────────────── */
// Emails per hour per mailbox: the user's pick, else the provider default
// (gmail 40, gsuite 150, rediff 30, yahoo 10, others 10).
const hourlyLimitFor = (customLimits, accountId, provider) => {
  const n = Number(customLimits?.[accountId]);
  return Number.isFinite(n) && n > 0 ? n : getDefaultHourlyLimit(provider);
};

/** One explicit limit (1–1000/hr) per selected mailbox. */
function normalizeCustomLimits(customLimits, accounts) {
  const out = {};
  for (const a of accounts) {
    const n = Math.round(Number(customLimits?.[a.id]));
    out[a.id] =
      Number.isFinite(n) && n > 0
        ? Math.min(n, 1000)
        : getDefaultHourlyLimit(a.provider);
  }
  return out;
}

function formatDuration(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   NEW — GET DAILY LIMIT STATUS
   GET /api/campaigns/daily-limit
   Used by the frontend banner / status widget.
═══════════════════════════════════════════════════════════════════════════ */
export const getDailyLimitStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    // Polled by several components at once — getDailyCount caches and
    // de-duplicates, so this is at most one SUM per user every few seconds.
    const sentToday = await getDailyCount(userId);
    const remaining = Math.max(0, DAILY_LIMIT - sentToday);
    const inWindow = true;

    res.set("Cache-Control", "private, max-age=5");
    return res.json({
      success: true,
      data: {
        dailySent: sentToday,
        dailyLimit: DAILY_LIMIT,
        remaining,
        limitReached: sentToday >= DAILY_LIMIT,
        withinWindow: inWindow,
        windowResetsIn: null,
        windowResetsAt: null,
        percentUsed: Math.min(100, Math.round((sentToday / DAILY_LIMIT) * 100)),
      },
    });
  } catch (err) {
    console.error("getDailyLimitStatus error:", err);
    return res.status(500).json({ success: false });
  }
};

export const getAdminDailyOverview = async (req, res) => {
  try {
    // ── 1. Role guard (the page is Admin/HR-only in the UI too) ─────────────
    if (!isAdminOrHr(req.user)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const cached = cache.get("adminDailyOverview");
    if (cached) return res.json({ success: true, data: cached });

    // ── 2. All active users ──────────────────────────────────────────────────
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, empId: true, email: true, jobRole: true },
      orderBy: { name: "asc" },
    });

    // ── 3. IST-aware bucket start (same logic as getDailyCount) ──────────────
    const nowIST = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );
    const resetToday = new Date(nowIST);
    resetToday.setHours(17, 0, 0, 0);

    const bucketStart =
      nowIST < resetToday
        ? new Date(resetToday.getTime() - 24 * 60 * 60 * 1000)
        : resetToday;

    // ── 4. Bulk-fetch DailyEmailLog rows for current bucket ──────────────────
    const logs = await prisma.dailyEmailLog.groupBy({
      by: ["userId"],
      _sum: { count: true },
      _max: { sentAt: true },
      where: { sentAt: { gte: bucketStart } },
    });

    const logMap = {};
    for (const row of logs) {
      logMap[row.userId] = {
        sent: row._sum.count || 0,
        lastSentAt: row._max.sentAt,
      };
    }

    // ── 5. Bulk-fetch active (sending) campaign counts per user ──────────────
    const sendingCampaigns = await prisma.campaign.groupBy({
      by: ["userId"],
      _count: { id: true },
      where: { status: "sending" },
    });

    const sendingMap = {};
    for (const row of sendingCampaigns) {
      sendingMap[row.userId] = row._count.id;
    }

    // ── 6. Build per-user rows ───────────────────────────────────────────────
    let totalSentToday = 0;

    const rows = users.map((u) => {
      const dailySent = logMap[u.id]?.sent || 0;
      const lastSentAt = logMap[u.id]?.lastSentAt || null;
      const activeCampaigns = sendingMap[u.id] || 0;
      const remaining = Math.max(0, DAILY_LIMIT - dailySent);
      const percentUsed = Math.min(
        100,
        Math.round((dailySent / DAILY_LIMIT) * 100),
      );

      totalSentToday += dailySent;

      // status logic:
      // "sending"   → has at least one campaign currently sending
      // "completed" → hit/exceeded daily limit
      // "idle"      → sent nothing today
      // "active"    → sent some emails, no campaign running right now
      let status = "idle";
      if (activeCampaigns > 0) status = "sending";
      else if (dailySent >= DAILY_LIMIT) status = "completed";
      else if (dailySent > 0) status = "active";

      return {
        userId: u.id,
        name: u.name || u.email.split("@")[0],
        empId: u.empId || "—",
        email: u.email,
        jobRole: String(u.jobRole || "EMP").trim(),
        dailySent,
        dailyLimit: DAILY_LIMIT,
        remaining,
        percentUsed,
        status,
        activeCampaigns,
        lastSentAt,
      };
    });

    // Sort: sending first, then active, then idle
    const ORDER = { sending: 0, active: 1, completed: 2, idle: 3 };
    rows.sort(
      (a, b) =>
        (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) ||
        b.dailySent - a.dailySent,
    );

    const data = {
      generatedAt: new Date().toISOString(),
      totalSentToday,
      globalLimit: DAILY_LIMIT * users.length,
      users: rows,
    };
    cache.set("adminDailyOverview", data, 10);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("getAdminDailyOverview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const createCampaign = async (req, res) => {
  try {
    const {
      campaignName,
      subjects,
      bodyHtml,
      recipients,
      fromAccountIds,
      pitchIds,
      sendType,
      scheduledAt,
      customLimits,
      senderRole,
    } = req.body;

    // 1️⃣ Basic validation
    if (!campaignName || !campaignName.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Campaign name is required" });
    }
    if (
      !Array.isArray(subjects) ||
      !subjects.length ||
      !bodyHtml ||
      !Array.isArray(recipients) ||
      !recipients.length ||
      !Array.isArray(fromAccountIds) ||
      !fromAccountIds.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Subjects, body, recipients and from accounts are required",
      });
    }
    if (!["immediate", "scheduled"].includes(sendType)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid send type" });
    }
    if (
      sendType === "scheduled" &&
      (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid scheduled time is required",
      });
    }

    // 2️⃣ 🌐 Global daily limit + window check (immediate only)
    //    Scheduled campaigns are allowed to be created at any time —
    //    the service layer will wait automatically when they fire.
    if (sendType === "immediate") {
      const blocked = await checkGlobalSendingRules(req.user.id);
      if (blocked) return res.status(blocked.status).json(blocked.body);
    }

    // 3️⃣ A mailbox that still has emails to send in another campaign can't
    //    be used until its part of that campaign is finished.
    {
      const busy = await getBusyAccountIds();
      const taken = fromAccountIds.map(Number).filter((id) => busy.has(id));
      if (taken.length) {
        return res.status(400).json({
          success: false,
          busyAccountIds: taken,
          message: `${taken.length} selected mailbox(es) are still sending another campaign. They become available as soon as their emails there are sent.`,
        });
      }
    }

    // 4️⃣ Provider limit / estimated completion
    const fromIds = [
      ...new Set(fromAccountIds.map(Number).filter(Number.isInteger)),
    ];
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: fromIds }, userId: req.user.id, deleted: false },
      select: { id: true, provider: true },
    });
    if (accounts.length !== fromIds.length) {
      return res.status(400).json({
        success: false,
        message: "One or more sender accounts are invalid",
      });
    }

    // Normalise + de-duplicate recipients once.
    const uniqueRecipients = [
      ...new Set(
        recipients
          .map((e) =>
            String(e || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];
    if (!uniqueRecipients.length) {
      return res
        .status(400)
        .json({ success: false, message: "No valid recipients" });
    }

    const limits = normalizeCustomLimits(customLimits, accounts);
    let totalHourlyCapacity = 0;
    for (const acc of accounts) totalHourlyCapacity += limits[acc.id];

    const hoursNeeded =
      uniqueRecipients.length / Math.max(totalHourlyCapacity, 1);
    const estimatedMs = hoursNeeded * 60 * 60 * 1000;
    const estimatedCompletion = new Date(Date.now() + estimatedMs);

    // 5️⃣ Auto-unique campaign name
    let baseName = campaignName.trim();
    let finalName = baseName;

    const existing = await prisma.campaign.findMany({
      where: { userId: req.user.id, name: { startsWith: baseName } },
      select: { name: true },
    });
    const used = existing.map((c) => c.name);
    if (used.includes(baseName)) {
      let i = 2;
      while (used.includes(`${baseName} (${i})`)) i++;
      finalName = `${baseName} (${i})`;
    }

    // 6️⃣ (Removed) schedule-conflict check — shared mailbox pacing makes
    //    overlapping campaigns safe.

    // 7️⃣ Create campaign, then bulk-insert recipients.
    //    The old nested `recipients: { create: [...] }` issued one INSERT
    //    per recipient. createMany sends them in a few multi-row INSERTs.
    const campaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: finalName,
        bodyHtml,
        sendType,
        estimatedCompletion,
        senderRole,
        scheduledAt: sendType === "scheduled" ? new Date(scheduledAt) : null,
        status: sendType === "scheduled" ? "scheduled" : "draft",
        subject: JSON.stringify(subjects),
        fromAccountIds: JSON.stringify(fromIds),
        pitchIds: JSON.stringify(pitchIds || []),
        customLimits: JSON.stringify(limits),
        totalRecipients: uniqueRecipients.length,
      },
      select: {
        id: true,
        name: true,
        status: true,
        sendType: true,
        scheduledAt: true,
        createdAt: true,
        estimatedCompletion: true,
        fromAccountIds: true,
      },
    });

    try {
      for (
        let i = 0;
        i < uniqueRecipients.length;
        i += RECIPIENT_INSERT_CHUNK
      ) {
        const chunk = uniqueRecipients.slice(i, i + RECIPIENT_INSERT_CHUNK);
        await prisma.campaignRecipient.createMany({
          data: chunk.map((email, j) => ({
            campaignId: campaign.id,
            email,
            status: "pending",
            accountId: fromIds[(i + j) % fromIds.length],
          })),
          skipDuplicates: true,
        });
      }
    } catch (insertErr) {
      // Don't leave a half-filled campaign behind.
      await prisma.campaign
        .delete({ where: { id: campaign.id } })
        .catch(() => {});
      throw insertErr;
    }

    // 8️⃣ Immediate campaigns: mark "sending" — the worker starts them.
    if (campaign.sendType === "immediate") {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "sending" },
      });
      campaign.status = "sending";
    }
    invalidateDashboardCache(req.user.id);

    return res.json({ success: true, data: campaign });
  } catch (err) {
    console.error("Create campaign error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   SEND CAMPAIGN NOW
═══════════════════════════════════════════════════════════════════════════ */
export const sendCampaignNow = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
      fromAccountIds: true,
    });
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    if (["sent", "completed", "sending"].includes(campaign.status)) {
      return res.json({
        success: true,
        message: `Campaign is already ${campaign.status}`,
      });
    }

    // 🌐 Global check
    const blocked = await checkGlobalSendingRules(campaign.userId);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending", error: null },
    });
    invalidateDashboardCache(campaign.userId);

    return res.json({ success: true, message: "Campaign sending started" });
  } catch (err) {
    console.error("sendCampaignNow error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to send campaign" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEDULE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const scheduleCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const { scheduledAt } = req.body;

    if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) {
      return res.status(400).json({
        success: false,
        message: "A valid scheduled time is required",
      });
    }

    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
    });
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    if (campaign.status === "sending") {
      return res.status(400).json({
        success: false,
        message: "Stop the campaign before rescheduling it",
      });
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { scheduledAt: new Date(scheduledAt), status: "scheduled" },
    });

    invalidateDashboardCache(campaign.userId);
    return res.json({ success: true });
  } catch (err) {
    console.error("Schedule campaign error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to schedule campaign" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE FOLLOW-UP CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
/**
 * Which of `emails` must be left out of a follow-up to `baseCampaignId`.
 * Three set-based queries regardless of list size.
 * @returns {{ byEmail: Map<string,string>, summary: {suppressed:number, replied:number, bounced:number} }}
 */
async function findFollowupExclusions(baseCampaignId, emails) {
  const byEmail = new Map();
  const summary = { suppressed: 0, replied: 0, bounced: 0 };
  if (!emails.length) return { byEmail, summary };

  const rootId = await resolveOriginalCampaignId(baseCampaignId);

  const [suppressed, engaged] = await Promise.all([
    prisma.$queryRaw`
      SELECT "email" FROM "SuppressedEmail" WHERE "email" = ANY(${emails}::text[])
    `,
    prisma.$queryRaw`
      SELECT o."email",
             coalesce(bool_or(
               o."repliedAt" IS NOT NULL
               OR EXISTS (
                 SELECT 1 FROM "ReplyEvent" e
                 WHERE e."email" = o."email" AND e."receivedAt" >= o."sentAt"
               )
             ), false) AS replied,
             coalesce(bool_or(o."bounceType" = 'hard'), false) AS bounced
      FROM "CampaignRecipient" o
      WHERE o."campaignId" = ANY(${[...new Set([rootId, baseCampaignId])]}::int[])
        AND o."email" = ANY(${emails}::text[])
        AND o."status" = 'sent'
      GROUP BY o."email"
    `,
  ]);

  for (const r of suppressed) {
    byEmail.set(r.email, "suppressed");
    summary.suppressed++;
  }
  for (const r of engaged) {
    if (byEmail.has(r.email)) continue;
    if (r.replied) {
      byEmail.set(r.email, "replied");
      summary.replied++;
    } else if (r.bounced) {
      byEmail.set(r.email, "bounced");
      summary.bounced++;
    }
  }
  return { byEmail, summary };
}

export const createFollowupCampaign = async (req, res) => {
  try {
    const { baseCampaignId, subjects, bodyHtml, senderRecipientMap } = req.body;

    if (!baseCampaignId || !senderRecipientMap) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payload" });
    }

    // 🌐 Global check
    const blocked = await checkGlobalSendingRules(req.user.id);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    // Was selecting every recipient of the base campaign, unused.
    const baseCampaign = await findManageableCampaign(
      req,
      Number(baseCampaignId),
      {
        id: true,
        name: true,
        senderRole: true,
        customLimits: true,
      },
    );

    if (!baseCampaign)
      return res
        .status(404)
        .json({ success: false, message: "Base campaign not found" });

    const senderEntries = Object.entries(senderRecipientMap || {});
    if (!senderEntries.length) {
      return res
        .status(400)
        .json({ success: false, message: "No recipients selected" });
    }

    // (Removed) busy-mailbox check: mailboxes are shared safely between
    // campaigns by the worker's per-mailbox pacing.

    let finalName = `${baseCampaign.name} (Followup)`;
    const existing = await prisma.campaign.findMany({
      where: { userId: req.user.id, name: { startsWith: finalName } },
      select: { name: true },
    });
    const used = existing.map((c) => c.name);
    if (used.includes(finalName)) {
      let i = 2;
      while (used.includes(`${finalName} (${i})`)) i++;
      finalName = `${finalName} (${i})`;
    }

    const followupCampaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: finalName,
        subject: JSON.stringify(subjects || []),
        bodyHtml: bodyHtml || "",
        sendType: "followup",
        status: "draft",
        parentCampaignId: baseCampaign.id,
        fromAccountIds: JSON.stringify([]),
        pitchIds: JSON.stringify([]),
        senderRole: baseCampaign.senderRole || "",
        // ✅ Inherit rate limits from parent so follow-ups obey the same /hr setting
        customLimits: baseCampaign.customLimits || null,
      },
    });

    const candidates = [];
    const seen = new Set();
    for (const [senderId, emailArray] of senderEntries) {
      const accountId = Number(senderId);
      if (!Number.isInteger(accountId) || !Array.isArray(emailArray)) continue;
      for (const raw of emailArray) {
        const email = normalizeEmail(raw);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        candidates.push({ email, accountId });
      }
    }

    // Leave out people who must not get a follow-up: on the do-not-contact
    // list, already replied, or whose original hard-bounced. (The engine
    // re-checks at send time; this keeps the counts honest from the start.)
    const excluded = await findFollowupExclusions(
      baseCampaign.id,
      candidates.map((c) => c.email),
    );
    const recipientCreates = candidates
      .filter((c) => !excluded.byEmail.has(c.email))
      .map((c) => ({
        campaignId: followupCampaign.id,
        email: c.email,
        status: "pending",
        accountId: c.accountId,
      }));

    if (!recipientCreates.length) {
      await prisma.campaign
        .delete({ where: { id: followupCampaign.id } })
        .catch(() => {});
      return res.status(400).json({
        success: false,
        message:
          "Everyone selected has replied, unsubscribed or bounced — no follow-up needed.",
        excluded: excluded.summary,
      });
    }

    try {
      for (
        let i = 0;
        i < recipientCreates.length;
        i += RECIPIENT_INSERT_CHUNK
      ) {
        await prisma.campaignRecipient.createMany({
          data: recipientCreates.slice(i, i + RECIPIENT_INSERT_CHUNK),
          skipDuplicates: true,
        });
      }
      await prisma.campaign.update({
        where: { id: followupCampaign.id },
        data: { totalRecipients: recipientCreates.length },
      });
    } catch (insertErr) {
      await prisma.campaign
        .delete({ where: { id: followupCampaign.id } })
        .catch(() => {});
      throw insertErr;
    }

    invalidateDashboardCache(req.user.id);

    return res.json({
      success: true,
      data: followupCampaign,
      recipients: recipientCreates.length,
      excluded: excluded.summary,
    });
  } catch (err) {
    console.error("Followup campaign error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   SEND FOLLOW-UP CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const sendFollowupCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
      sendType: true,
    });

    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    if (campaign.sendType !== "followup") {
      return res
        .status(400)
        .json({ success: false, message: "Not a follow-up campaign" });
    }
    if (campaign.status === "sending") return res.json({ success: true });

    // 🌐 Global check
    const blocked = await checkGlobalSendingRules(campaign.userId);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending", error: null },
    });
    invalidateDashboardCache(campaign.userId);

    return res.json({ success: true });
  } catch (err) {
    console.error("sendFollowupCampaign error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET ALL CAMPAIGNS
═══════════════════════════════════════════════════════════════════════════ */
export const getAllCampaigns = async (req, res) => {
  try {
    /* ── namesOnly mode ───────────────────────────────────────────────────
       CreateCampaign.jsx calls this endpoint only to collect existing
       campaign names for its duplicate check. Serving that from the full
       payload meant loading every campaign AND running a groupBy across
       every recipient row for counts nobody reads. Two columns instead. */
    if (req.query.namesOnly === "true") {
      const nameKey = `campaignNames:${req.user.id}`;
      const nameCached = cache.get(nameKey);
      if (nameCached) return res.json({ success: true, data: nameCached });

      const rows = await prisma.campaign.findMany({
        where: { userId: req.user.id },
        select: { id: true, name: true },
      });

      cache.set(nameKey, rows, 30);
      return res.json({ success: true, data: rows });
    }

    const cacheKey = `allCampaigns:${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    // ⚡ OPTIMISED: no longer selects `recipients` (which pulled every row for
    // every campaign) and no longer selects `bodyHtml` (the full email
    // template, per campaign). Counts come from one grouped query instead.
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        sendType: true,
        subject: true,
        fromAccountIds: true,
        parentCampaignId: true,
        createdAt: true,
        estimatedCompletion: true,
      },
    });

    const counts = await getRecipientCounts(campaigns.map((c) => c.id));

    const result = campaigns.map((c) => ({
      ...c,
      // ⚠ FRONTEND: campaign.recipients is gone — use these counts instead.
      ...countFields(counts[c.id] || EMPTY_COUNTS),
    }));

    cache.set(cacheKey, result, 20);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("Get campaigns error:", err);
    res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET DASHBOARD CAMPAIGNS
═══════════════════════════════════════════════════════════════════════════ */
export const getDashboardCampaigns = async (req, res) => {
  try {
    const userId = req.user.id;
    const { range = "all", date, page = "1", pageSize = "25" } = req.query;

    const take = Math.min(Number(pageSize) || 25, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const cacheKey = `dashboard:${userId}:${date || range}:${page}:${take}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    /* -- date range (same logic, but no longer mutates `now` via setHours) -- */
    let startDate = null;
    let endDate = null;
    const now = new Date();

    if (range === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date();
    } else if (range === "week") {
      const firstDay = new Date(now);
      firstDay.setDate(now.getDate() - now.getDay());
      firstDay.setHours(0, 0, 0, 0);
      startDate = firstDay;
      endDate = new Date();
    } else if (range === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date();
    }
    if (date) {
      const d = new Date(date);
      startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      endDate = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        23,
        59,
        59,
        999,
      );
    }

    const where = {
      userId,
      ...(startDate && { createdAt: { gte: startDate, lte: endDate } }),
    };

    /* -- 1. campaign rows for THIS PAGE ONLY, no recipients ---------------- */
    const [campaigns, totalCount] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: {
          id: true,
          name: true,
          status: true,
          sendType: true,
          subject: true,
          createdAt: true,
          scheduledAt: true,
          estimatedCompletion: true,
          parentCampaignId: true,
          fromAccountIds: true,
        },
      }),
      prisma.campaign.count({ where }),
    ]);

    /* -- 2. header stats over the WHOLE range (not just this page) ---------
       Two cheap queries: the id/sendType list, then one grouped count.
       No recipient rows ever enter Node's memory.                          */
    const allInRange = await prisma.campaign.findMany({
      where,
      select: { id: true, sendType: true },
    });

    const followupIds = new Set(
      allInRange.filter((c) => c.sendType === "followup").map((c) => c.id),
    );
    const totalFollowups = followupIds.size;
    const totalCampaigns = allInRange.length - totalFollowups;

    const statRows = allInRange.length
      ? await prisma.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          where: { campaignId: { in: allInRange.map((c) => c.id) } },
          _count: { _all: true },
        })
      : [];

    let totalRecipients = 0,
      sentRecipients = 0,
      pendingRecipients = 0,
      failedRecipients = 0,
      followupEmails = 0;

    for (const row of statRows) {
      const n = row._count._all;
      if (followupIds.has(row.campaignId)) {
        followupEmails += n;
        continue;
      }
      totalRecipients += n;
      if (row.status === "sent") sentRecipients += n;
      else if (row.status === "failed") failedRecipients += n;
      else if (row.status === "pending" || row.status === "processing")
        pendingRecipients += n;
    }

    /* -- 3. per-row counts for the visible page only ------------------------ */
    const counts = await getRecipientCounts(campaigns.map((c) => c.id));

    /* -- 4. sender labels --------------------------------------------------- */
    const accountIds = new Set();
    for (const c of campaigns) {
      try {
        JSON.parse(c.fromAccountIds || "[]").forEach((id) =>
          accountIds.add(Number(id)),
        );
      } catch {
        /* malformed JSON on this row — skip */
      }
    }

    let accountEmailMap = {};
    if (accountIds.size > 0) {
      const allAccounts = await prisma.emailAccount.findMany({
        where: { id: { in: Array.from(accountIds) } },
        select: { id: true, email: true },
      });
      allAccounts.forEach((acc) => {
        accountEmailMap[acc.id] = acc.email.split("@")[0] + "@";
      });
    }

    const recentCampaigns = campaigns.map((campaign) => {
      let fromNames = [];
      try {
        fromNames = JSON.parse(campaign.fromAccountIds || "[]")
          .map((id) => accountEmailMap[Number(id)])
          .filter(Boolean);
      } catch {
        /* ignore */
      }

      return {
        ...campaign,
        fromNames,
        // ⚠ FRONTEND: campaign.recipients is no longer returned. Use these.
        ...countFields(counts[campaign.id] || EMPTY_COUNTS),
      };
    });

    const responseData = {
      stats: {
        totalCampaigns,
        totalRecipients,
        sentRecipients,
        pendingRecipients,
        failedRecipients,
        totalFollowups,
        followupEmails,
      },
      recentCampaigns,
      pagination: { page: Number(page), pageSize: take, total: totalCount },
    };

    cache.set(cacheKey, responseData, 15);
    return res.json({ success: true, data: responseData });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET CAMPAIGN PROGRESS
═══════════════════════════════════════════════════════════════════════════ */
export const getCampaignProgress = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    // Short micro-cache: this endpoint is polled every 5s per expanded row,
    // so concurrent pollers within the same tick collapse to one query.
    // Key includes the user: the old `progress:${id}` key was served from
    // cache BEFORE the ownership check, leaking other users' progress.
    const cacheKey = `progress:${req.user.id}:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const campaign = await findManageableCampaign(req, id, {
      id: true,
      customLimits: true,
    });
    if (!campaign) return res.status(404).json({ success: false });

    let customLimits = {};
    try {
      if (campaign.customLimits)
        customLimits = JSON.parse(campaign.customLimits);
    } catch {
      /* malformed — fall back to provider defaults */
    }

    /* ⚡ OPTIMISED: was `include: { recipients: true }`, which pulled every
       column of every recipient row — including sentBodyHtml, the full
       rendered email — every 5 seconds. Now one grouped count.            */
    const [grouped, ipRows] = await Promise.all([
      prisma.campaignRecipient.groupBy({
        by: ["accountId", "status"],
        where: { campaignId: id, accountId: { not: null } },
        _count: { _all: true },
      }),
      prisma.$queryRaw`
        SELECT DISTINCT ON ("accountId") "accountId", "sendingIp"
        FROM "CampaignRecipient"
        WHERE "campaignId" = ${id}
          AND "accountId" IS NOT NULL
          AND "sendingIp" IS NOT NULL
        ORDER BY "accountId", "id"
      `,
    ]);

    const accountIds = [...new Set(grouped.map((g) => g.accountId))];
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, email: true, provider: true },
    });

    const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
    const ipMap = Object.fromEntries(
      ipRows.map((r) => [r.accountId, r.sendingIp]),
    );

    const rows = {};
    for (const g of grouped) {
      const account = byId[g.accountId];
      if (!account) continue;

      if (!rows[account.id]) {
        rows[account.id] = {
          email: account.email,
          domain: account.provider,
          processing: 0,
          completed: 0,
          failed: 0,
          skipped: 0,
          sendingIp: ipMap[account.id] || null,
          eta: "0m",
        };
      }

      const n = g._count._all;
      if (g.status === "sent") rows[account.id].completed += n;
      else if (g.status === "failed") rows[account.id].failed += n;
      else if (g.status === "skipped") rows[account.id].skipped += n;
      else if (g.status === "pending" || g.status === "processing")
        rows[account.id].processing += n;
    }

    for (const [accId, row] of Object.entries(rows)) {
      const limit = hourlyLimitFor(customLimits, accId, row.domain);
      row.eta =
        row.processing === 0
          ? "Done"
          : formatDuration((row.processing / limit) * 3_600_000);
    }

    const result = Object.values(rows);
    cache.set(cacheKey, result, 8);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("Progress API error:", err);
    return res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET CAMPAIGN STATUS  —  GET /api/campaigns/:id/status
   Everything the CRM needs to explain a campaign: what it's doing and why,
   why recipients are pending / failed / skipped, each mailbox's state,
   limits and resume time, and a realistic completion estimate.
═══════════════════════════════════════════════════════════════════════════ */
export const getCampaignStatusDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const owned = await findManageableCampaign(req, id, { id: true });
    if (!owned)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    const cacheKey = `progress:${req.user.id}:status:${id}`;
    const hit = cache.get(cacheKey);
    if (hit) return res.json({ success: true, data: hit });

    const data = await buildCampaignStatus(id);
    if (!data) return res.status(404).json({ success: false });
    cache.set(cacheKey, data, 8);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("Campaign status error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load campaign status" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET LOCKED ACCOUNTS
═══════════════════════════════════════════════════════════════════════════ */
export const getLockedAccounts = async (req, res) => {
  try {
    // Mailboxes that still have emails to send in a sending campaign.
    const details = await getBusyAccounts();
    const busy = [...new Set(details.map((d) => d.accountId))];
    return res.json({
      success: true,
      data: {
        busy,
        busyDetails: details,
        inUse: [],
        defaultHourlyLimit: DEFAULT_HOURLY_LIMIT,
        providerHourlyLimits: PROVIDER_HOURLY_LIMITS,
      },
    });
  } catch (err) {
    console.error("getLockedAccounts error:", err);
    res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const deleteCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
    });
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    if (campaign.status === "sending") {
      return res.status(400).json({
        success: false,
        message: "Stop the campaign before deleting it",
      });
    }

    // Recipients cascade from Campaign. Child follow-ups keep existing,
    // detached from the deleted parent.
    await prisma.$transaction([
      prisma.campaign.updateMany({
        where: { parentCampaignId: campaignId },
        data: { parentCampaignId: null },
      }),
      prisma.campaign.delete({ where: { id: campaignId } }),
    ]);

    invalidateDashboardCache(campaign.userId);
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete campaign error:", err);
    res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET CAMPAIGNS FOR FOLLOWUP
═══════════════════════════════════════════════════════════════════════════ */
export const getCampaignsForFollowup = async (req, res) => {
  const t0 = Date.now();
  const mark = {};

  try {
    const userId = req.user.id;
    const level = Math.min(Math.max(Number(req.query.level) || 1, 1), 4);
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const cacheKey = `forFollowup:${userId}:${level}:${offset}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.items, ...cached });
    }

    /* ── ONE query for every campaign this user owns ─────────────────────
       Was two separate findMany calls (base campaigns + follow-ups).
       The select is deliberately tiny — no bodyHtml, no recipients — so
       even a few hundred rows is a small result set.                     */
    const tQuery = Date.now();
    const all = await prisma.campaign.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        sendType: true,
        subject: true,
        createdAt: true,
        fromAccountIds: true,
        parentCampaignId: true,
        estimatedCompletion: true,
      },
    });
    mark.campaigns = Date.now() - tQuery;
    mark.campaignRows = all.length;

    /* ── Partition in memory (microseconds, no DB round trip) ─────────── */
    const activeParents = new Set();
    const completedCount = {};
    const baseCampaigns = [];

    for (const c of all) {
      if (c.sendType === "followup" && c.parentCampaignId) {
        if (c.status === "completed") {
          completedCount[c.parentCampaignId] =
            (completedCount[c.parentCampaignId] || 0) + 1;
        } else if (["draft", "sending", "scheduled"].includes(c.status)) {
          activeParents.add(c.parentCampaignId);
        }
      } else if (
        !c.parentCampaignId &&
        c.status === "completed" &&
        (c.sendType === "immediate" || c.sendType === "scheduled")
      ) {
        baseCampaigns.push(c);
      }
    }

    const eligible = baseCampaigns.filter((c) => {
      if (activeParents.has(c.id)) return false;
      const done = completedCount[c.id] || 0;
      return done < 4 && done === level - 1;
    });
    mark.eligible = eligible.length;

    /* ── Page the eligible list ───────────────────────────────────────────
       Slicing happens AFTER filtering — eligibility depends on the whole
       set, so it cannot be pushed into the SQL LIMIT. What this does save
       is the count query below, which now covers only the visible page.  */
    const total = eligible.length;
    const pageRows = eligible.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    mark.total_eligible = total;
    mark.returned = pageRows.length;

    if (pageRows.length === 0) {
      const empty = { items: [], total, hasMore: false, offset, limit };
      cache.set(cacheKey, empty, 20);
      return res.json({ success: true, data: [], ...empty });
    }

    /* ── Sent counts, only for the rows actually being returned ────────── */
    const tCounts = Date.now();
    const sentRows = await prisma.campaignRecipient.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: pageRows.map((c) => c.id) }, status: "sent" },
      _count: { _all: true },
    });
    mark.counts = Date.now() - tCounts;

    const sentMap = Object.fromEntries(
      sentRows.map((r) => [r.campaignId, r._count._all]),
    );

    const data = pageRows.map((c) => ({
      ...c,
      sentCount: sentMap[c.id] || 0,
      recipientCount: sentMap[c.id] || 0,
      followupNumber: (completedCount[c.id] || 0) + 1,
    }));

    cache.set(cacheKey, { items: data, total, hasMore, offset, limit }, 20);

    /* Two DB round trips total. If `total` is far larger than
       campaigns + counts, the time is spent WAITING FOR A CONNECTION,
       not running queries — see the worker-split note in PERFORMANCE_FIXES. */
    const elapsed = Date.now() - t0;
    mark.total = elapsed;
    mark.waiting = elapsed - (mark.campaigns + (mark.counts || 0));
    if (elapsed > 2000) console.warn(`[for-followup] slow: ${elapsed}ms`, mark);

    return res.json({
      success: true,
      data,
      total,
      hasMore,
      offset,
      limit,
      _timing: mark,
    });
  } catch (err) {
    console.error(
      "Get campaigns for followup error:",
      err,
      "after",
      Date.now() - t0,
      "ms",
    );
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET FOLLOW-UP PREVIEW  (NEW)
   GET /api/campaigns/:id/followup-preview

   Everything the Follow-up "Email Preview" panel needs, in ONE request:
     • sentCount            — via a single COUNT (not a full row fetch)
     • previewRecipients    — first 3 sent rows only (enough for "To: a, b +N more")
     • previousBody         — sentBodyHtml of the first sent row, or bodyHtml fallback

   This replaces the old client-side chain of:
     GET /:id/view?pageSize=1
     GET /:id/recipients?status=sent        (UNPAGINATED — every sent row)
     GET /:id/recipients/:recipientId/body  (only fires AFTER the above resolves)

   That chain pulled every sent recipient just to show two email addresses
   and a count, then paid a third, fully sequential round trip for the
   preview body. For a campaign with hundreds/thousands of sent recipients
   that unpaginated list was also the single largest payload in the whole
   Follow-ups flow. This endpoint does 3 tiny, parallel DB queries and
   returns one small JSON object — one round trip, no large payload.

   The FULL unpaginated recipient list (with accountId, needed to build
   senderRecipientMap) is still fetched via GET /:id/recipients?status=sent
   — just lazily, at the moment "Create Follow-up" is actually clicked,
   not on every campaign selection.
═══════════════════════════════════════════════════════════════════════════ */
export const getFollowupPreview = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id, userId: req.user.id },
      select: {
        id: true,
        name: true,
        subject: true,
        fromAccountIds: true,
        createdAt: true,
        bodyHtml: true,
      },
    });
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }
    // From-addresses: normal campaigns keep the ids on the campaign, follow-ups
    // write fromAccountIds: "[]" and carry the sender per recipient instead.
    let declaredIds = [];
    try {
      declaredIds = JSON.parse(campaign.fromAccountIds || "[]").map(Number);
    } catch {}

    const assigned = await prisma.campaignRecipient.findMany({
      where: { campaignId: id, accountId: { not: null } },
      select: { accountId: true },
      distinct: ["accountId"],
    });

    const fromAccountIdList = [
      ...new Set([...declaredIds, ...assigned.map((a) => a.accountId)]),
    ].filter(Number.isInteger);

    const accounts = fromAccountIdList.length
      ? await prisma.emailAccount.findMany({
          where: { id: { in: fromAccountIdList } },
          select: { id: true, email: true, smtpUser: true },
        })
      : [];

    // Mirror processAccountBatched: fromEmail = smtpUser || email
    const fromAccounts = accounts.map((a) => ({
      id: a.id,
      email: a.smtpUser || a.email,
    }));

    const [sentCount, previewRecipients] = await Promise.all([
      prisma.campaignRecipient.count({
        where: { campaignId: id, status: "sent" },
      }),
      prisma.campaignRecipient.findMany({
        where: { campaignId: id, status: "sent" },
        orderBy: { id: "asc" },
        take: 3,
        select: {
          id: true,
          email: true,
          accountId: true,
          sentSubject: true,
          sentFromEmail: true,
          sentBodyHtml: true,
          sentAt: true,
        },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        campaign,
        sentCount,
        previewRecipients,
        previousBody:
          previewRecipients[0]?.sentBodyHtml || campaign.bodyHtml || "",
      },
    });
  } catch (err) {
    console.error("getFollowupPreview error:", err);
    return res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET SINGLE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const getSingleCampaign = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    const { status, page = "1", pageSize = "200", search } = req.query;
    const take = Math.min(Number(pageSize) || 200, 500);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    // Ownership check — previously any authenticated user could read any campaign.
    const campaign = await prisma.campaign.findFirst({
      where: { id, userId: req.user.id },
      select: {
        id: true,
        name: true,
        status: true,
        sendType: true,
        subject: true,
        createdAt: true,
        scheduledAt: true,
        estimatedCompletion: true,
        fromAccountIds: true,
        parentCampaignId: true,
        // Single campaign only — safe to include the template here. It is
        // deliberately NOT selected in the list endpoints, where it would be
        // multiplied by every campaign on the page.
        bodyHtml: true,
        originalBodyHtml: true,
        senderRole: true,
      },
    });
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    /* ⚡ Stats + engagement from one grouped query. */
    const k = (await getRecipientCounts([id]))[id] || EMPTY_COUNTS;

    const stats = {
      total: k.total,
      // `processing` includes in-flight rows, matching the modal's own
      // copy filter (pending || processing).
      processing: k.pending + k.processing,
      completed: k.sent,
      failed: k.failed,
      skipped: k.skipped,
      replied: k.replied,
      bounced: k.bounced,
      unsubscribed: k.unsubscribed,
      replyRate: k.sent ? Math.round((k.replied / k.sent) * 1000) / 10 : 0,
    };

    /* ⚡ Recipients: paginated, and sentBodyHtml is NOT selected. That field
       holds the entire rendered email per row, and was the bulk of the
       old multi-megabyte response. Fetch one on demand via
       GET /:id/recipients/:recipientId/body                              */
    const statusFilter =
      status === "completed"
        ? { status: "sent" }
        : status === "processing"
          ? { status: { in: ["pending", "processing"] } }
          : status === "failed"
            ? { status: "failed" }
            : status === "skipped"
              ? { status: "skipped" }
              : status === "replied"
                ? { repliedAt: { not: null } }
                : status === "bounced"
                  ? { bouncedAt: { not: null } }
                  : status === "unsubscribed"
                    ? { unsubscribedAt: { not: null } }
                    : {};

    const recipients = await prisma.campaignRecipient.findMany({
      where: {
        campaignId: id,
        ...statusFilter,
        ...(search ? { email: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      skip,
      select: {
        id: true,
        email: true,
        status: true,
        accountId: true,
        sentAt: true,
        sentSubject: true,
        sentFromEmail: true,
        sendingIp: true,
        error: true,
        repliedAt: true,
        bouncedAt: true,
        bounceType: true,
        unsubscribedAt: true,
      },
    });

    return res.json({
      success: true,
      data: {
        campaign: { ...campaign, recipients },
        stats,
        pagination: { page: Number(page), pageSize: take },
      },
    });
  } catch (err) {
    console.error("Get single campaign error:", err);
    res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET SINGLE RECIPIENT BODY  (NEW)
   GET /api/campaigns/:id/recipients/:recipientId/body

   Loads one rendered email on demand so the view modal never pulls
   hundreds of full HTML bodies up front.

   Register in campaigns.routes.js:
     router.get("/:id/recipients/:recipientId/body", protect, getRecipientBody);
═══════════════════════════════════════════════════════════════════════════ */
export const getRecipientBody = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const recipientId = Number(req.params.recipientId);

    if (!Number.isInteger(campaignId) || !Number.isInteger(recipientId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const row = await prisma.campaignRecipient.findFirst({
      where: {
        id: recipientId,
        campaignId,
        campaign: { userId: req.user.id },
      },
      select: {
        id: true,
        email: true,
        sentSubject: true,
        sentFromEmail: true,
        sentBodyHtml: true,
        sentAt: true,
      },
    });

    if (!row) return res.status(404).json({ success: false });
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error("getRecipientBody error:", err);
    return res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET ALL RECIPIENT ADDRESSES  (NEW)
   GET /api/campaigns/:id/recipients?status=sent

   Returns EVERY matching recipient — unpaginated — but only the four scalar
   columns needed to build a follow-up or a copy-to-clipboard list. No
   sentBodyHtml, so ~60 bytes/row instead of tens of KB.

   Use this (not /:id/view) anywhere the full set matters:
     • CampaignDetail.jsx  — building senderRecipientMap for a follow-up
     • Schedulemodal.jsx   — "Copy All" / "Copy Completed" / "Copy Failed"

   Register in campaigns.routes.js:
     router.get("/:id/recipients", protect, getCampaignRecipientEmails);
   NOTE: must be registered BEFORE "/:id/recipients/:recipientId/body".
═══════════════════════════════════════════════════════════════════════════ */
export const getCampaignRecipientEmails = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    const owns = await prisma.campaign.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true },
    });
    if (!owns)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    const { status, forFollowup } = req.query;
    const statusFilter =
      status === "sent" || status === "completed"
        ? { status: "sent" }
        : status === "processing"
          ? { status: { in: ["pending", "processing"] } }
          : status === "failed"
            ? { status: "failed" }
            : status === "skipped"
              ? { status: "skipped" }
              : {};

    // ?forFollowup=1 → only people a follow-up may still go to.
    const followupFilter =
      forFollowup === "1" || forFollowup === "true"
        ? {
            repliedAt: null,
            unsubscribedAt: null,
            // Explicit null branch: `bounceType <> 'hard'` is NULL (not true)
            // for rows that never bounced.
            OR: [{ bounceType: null }, { bounceType: { not: "hard" } }],
          }
        : {};

    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: id, ...statusFilter, ...followupFilter },
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        accountId: true,
        status: true,
        sentFromEmail: true,
      },
    });

    return res.json({
      success: true,
      data: recipients,
      count: recipients.length,
    });
  } catch (err) {
    console.error("getCampaignRecipientEmails error:", err);
    return res.status(500).json({ success: false });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   STOP CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const stopCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
    });

    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    if (!["sending", "scheduled"].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot pause a campaign that is ${campaign.status}`,
      });
    }

    // USER pause. The worker finishes the email going out this second and
    // then stops; nothing restarts it until the user clicks Resend.
    const who = req.user.name || req.user.email || "user";
    const updated = await prisma.campaign.updateMany({
      where: { id: campaignId, status: { in: ["sending", "scheduled"] } },
      data: {
        status: "stopped",
        error: `Paused by ${who} on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      },
    });
    // Rows claimed but not yet sent go back to the queue.
    await prisma.campaignRecipient.updateMany({
      where: {
        campaignId,
        status: "processing",
        updatedAt: { lt: new Date(Date.now() - 60_000) },
      },
      data: { status: "pending", updatedAt: new Date() },
    });
    invalidateDashboardCache(campaign.userId);
    delByPrefix("progress:");

    return res.json({
      success: updated.count > 0,
      message: updated.count
        ? "Campaign paused. Already-sent emails are kept — click Resend to continue where it stopped."
        : "Campaign was not sending",
    });
  } catch (err) {
    console.error("Stop campaign error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to stop campaign" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   RESEND (RESUME) CAMPAIGN
   POST /api/campaigns/:id/resend

   Resumes a paused ("stopped") campaign from where it left off.
   sendBulkCampaign / _sendBulkCampaignInner only ever queries recipients
   with status "pending" (see campaignMailer.service.js §6), so recipients
   that already went out ("sent") are never re-selected — resuming can never
   double-send. Recipients still mid-flight when the campaign was paused
   finish their in-progress batch before the stop is honored (see the
   campaign-status check at the top of runOneBatchCycle), so there's
   normally nothing left in "processing" to worry about; if the server
   crashed instead, worker.js's stuck-email sweep already resets those rows
   back to "pending" on its own schedule.
═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   CANCEL UNSENT EMAILS  —  POST /api/campaigns/:id/cancel-pending
   Body (optional): { accountId }  → only that mailbox's unsent emails.

   Keeps everything already sent (history, replies, follow-up chain) and
   marks the unsent recipients "skipped" with reason "Cancelled by user".
   When nothing is left, the campaign becomes "completed" and its mailboxes
   are free for new campaigns. Better than deleting the campaign, which
   would also erase the sent emails and their replies.
═══════════════════════════════════════════════════════════════════════════ */
export const cancelPendingRecipients = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
    });
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    const accountId =
      req.body?.accountId != null && req.body.accountId !== ""
        ? Number(req.body.accountId)
        : null;
    if (accountId !== null && !Number.isInteger(accountId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid mailbox" });

    // Only "pending" rows: a row already "processing" is being sent this
    // second and is allowed to finish (it can't be un-sent).
    const cancelled = await prisma.campaignRecipient.updateMany({
      where: {
        campaignId,
        status: "pending",
        ...(accountId !== null ? { accountId } : {}),
      },
      data: {
        status: "skipped",
        error: `Cancelled by ${req.user.name || req.user.email || "user"}`,
        updatedAt: new Date(),
      },
    });

    const left = await prisma.campaignRecipient.count({
      where: { campaignId, status: { in: ["pending", "processing"] } },
    });

    let status = campaign.status;
    if (
      left === 0 &&
      ["sending", "stopped", "paused", "scheduled", "draft"].includes(
        campaign.status,
      )
    ) {
      const sent = await prisma.campaignRecipient.count({
        where: { campaignId, status: "sent" },
      });
      status = sent > 0 || cancelled.count > 0 ? "completed" : campaign.status;
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status },
      });
    }

    invalidateDashboardCache(campaign.userId);
    delByPrefix(`progress:`); // status panel micro-cache

    return res.json({
      success: true,
      cancelled: cancelled.count,
      remaining: left,
      status,
      message:
        `${cancelled.count} unsent email(s) cancelled` +
        (left
          ? ` — ${left} other email(s) still sending.`
          : " — campaign marked completed. Sent emails are kept."),
    });
  } catch (err) {
    console.error("cancelPendingRecipients error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to cancel unsent emails" });
  }
};

export const resendCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    const campaign = await findManageableCampaign(req, campaignId, {
      id: true,
      userId: true,
      status: true,
      fromAccountIds: true,
    });
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    if (!["stopped", "paused", "failed"].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot resend a campaign that is ${campaign.status}`,
      });
    }
    // (No daily-limit block: if the company 5 000/day is used up, the
    //  campaign simply waits for the 5 PM reset and the CRM shows that.)

    // Nothing left to send? Don't spin up a worker for zero recipients —
    // just tell the user so instead of silently no-op-ing.
    // Rows left in "processing" by the stop are pending work too.
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, status: "processing" },
      data: { status: "pending", updatedAt: new Date() },
    });
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId, status: "pending" },
    });
    if (remaining === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No pending recipients left — every recipient has already been sent to (or failed permanently).",
      });
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending", error: null },
    });
    invalidateDashboardCache(campaign.userId);
    delByPrefix("progress:");

    return res.json({
      success: true,
      message: `Campaign resumed — ${remaining} email(s) left. Already-sent recipients won't be emailed again.`,
    });
  } catch (err) {
    console.error("Resend campaign error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to resend campaign" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE FOLLOWUP RECIPIENTS
═══════════════════════════════════════════════════════════════════════════ */
export const updateFollowupRecipients = async (req, res) => {
  try {
    const { campaignId, deletedRecipientIds } = req.body;

    if (!campaignId || !Array.isArray(deletedRecipientIds)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid payload: campaignId and deletedRecipientIds array required",
      });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: Number(campaignId), userId: req.user.id },
    });
    if (!campaign)
      return res.status(404).json({
        success: false,
        message: "Campaign not found or access denied",
      });

    if (deletedRecipientIds.length === 0) {
      return res.json({ success: true, message: "No changes to save" });
    }

    const ids = deletedRecipientIds.map(Number).filter(Number.isFinite);

    // Only ever delete the specific rows the user removed in the modal.
    // Scoped to this campaign + sent/completed status, so pending/failed
    // recipients (and anything belonging to another campaign) can never
    // be touched. Nothing is recreated, so there's no way for this to
    // wipe out recipients that weren't explicitly deleted.
    const result = await prisma.campaignRecipient.deleteMany({
      where: {
        id: { in: ids },
        campaignId: Number(campaignId),
        status: { in: ["sent", "completed"] },
      },
    });

    invalidateDashboardCache(req.user.id);
    return res.json({
      success: true,
      message: `Removed ${result.count} recipient(s)`,
    });
  } catch (err) {
    console.error("Update followup recipients error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update recipients",
    });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   FOLLOWUP CLEANUP JOB
═══════════════════════════════════════════════════════════════════════════ */
/**
 * Keeps at most 3 completed follow-ups per parent: when a parent has 4 or
 * more completed follow-ups older than a day, those are deleted.
 * Called by worker.js on a timer (single-flight, circuit-breaker aware).
 */
export async function runFollowupCleanup() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const oldFollowups = await prisma.campaign.findMany({
    where: {
      sendType: "followup",
      status: "completed",
      parentCampaignId: { not: null },
      createdAt: { lte: oneDayAgo },
      // Automated sequence steps are kept: they are that sequence's history.
      sequenceId: null,
    },
    select: { id: true, parentCampaignId: true, userId: true },
  });

  const countPerParent = {};
  for (const f of oldFollowups) {
    countPerParent[f.parentCampaignId] =
      (countPerParent[f.parentCampaignId] || 0) + 1;
  }

  const toDelete = oldFollowups.filter(
    (f) => countPerParent[f.parentCampaignId] >= 4,
  );

  for (const campaign of toDelete) {
    // Recipients cascade from Campaign; one statement per campaign.
    await prisma.campaign
      .delete({ where: { id: campaign.id } })
      .catch((err) => {
        if (err.code !== "P2025") throw err; // already gone
      });
    invalidateDashboardCache(campaign.userId);
  }

  if (toDelete.length) {
    console.log(
      `🗑️ Follow-up cleanup: deleted ${toDelete.length} old follow-up campaign(s)`,
    );
  }
}

/**
 * @deprecated worker.js schedules runFollowupCleanup itself. Kept so older
 * imports keep working.
 */
export const startFollowupCleanupJob = () => {
  const timer = setInterval(
    () => {
      runFollowupCleanup().catch((err) =>
        console.error("Followup cleanup job error:", err.message),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref?.();
};
