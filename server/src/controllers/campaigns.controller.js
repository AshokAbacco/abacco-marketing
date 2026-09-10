// campaigns.controller.js — Full file with Global Daily Limit (5 PM reset) + all original exports

import prisma from "../prismaClient.js";
import {
  sendBulkCampaign,
  getDailyCount,
  getBucketStartUtc,
} from "../services/campaignMailer.service.js";
import cache from "../utils/cache.js";

const DAILY_LIMIT = 5000;

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — invalidate dashboard cache
───────────────────────────────────────────────────────────────────────── */
const invalidateDashboardCache = (userId) => {
  const ranges = ["today", "week", "month"];
  ranges.forEach(range => cache.del(`dashboard:${userId}:${range}`));

  const keys = cache.keys();
  keys.forEach(key => {
    if (key.startsWith(`dashboard:${userId}:`)) cache.del(key);
  });

  cache.del(`locked:${userId}`);
  cache.del(`allCampaigns:${userId}`);
  cache.del(`campaignNames:${userId}`);

  // Follow-up eligibility changes whenever a campaign is created, completed,
  // stopped or deleted — clear all four level buckets.
  for (let lvl = 1; lvl <= 4; lvl++) cache.del(`forFollowup:${userId}:${lvl}`);
};

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — shared daily-limit + window pre-check
   Returns null if all clear, or { status, body } error object if blocked.
───────────────────────────────────────────────────────────────────────── */
async function checkGlobalSendingRules(userId) {
  const sentToday = await getDailyCount(userId);

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
   HELPER — per-campaign status counts via a single grouped query.
   Replaces the old pattern of loading every recipient row into Node.
   Returns { [campaignId]: { total, sent, pending, processing, failed } }
───────────────────────────────────────────────────────────────────────── */
async function getRecipientCounts(campaignIds) {
  if (!campaignIds.length) return {};

  const rows = await prisma.campaignRecipient.groupBy({
    by:     ["campaignId", "status"],
    where:  { campaignId: { in: campaignIds } },
    _count: { _all: true },
    _max:   { sentAt: true },
  });

  const map = {};
  for (const id of campaignIds) {
    map[id] = { total: 0, sent: 0, pending: 0, processing: 0, failed: 0, lastSentAt: null };
  }
  for (const r of rows) {
    const bucket = map[r.campaignId];
    if (!bucket) continue;
    const n = r._count._all;
    bucket.total += n;
    if (bucket[r.status] !== undefined) bucket[r.status] += n;

    // Latest actual send — replaces the old client-side
    // `recipients.filter(r => r.sentAt).sort(...)` scan.
    if (r.status === "sent" && r._max.sentAt) {
      if (!bucket.lastSentAt || r._max.sentAt > bucket.lastSentAt) {
        bucket.lastSentAt = r._max.sentAt;
      }
    }
  }
  return map;
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — per-provider hourly send limits (shared by progress + create)
───────────────────────────────────────────────────────────────────────── */
const SAFE_LIMITS = { gmail: 50, gsuite: 80, rediff: 40, amazon: 60, custom: 60 };

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
    const userId    = req.user.id;
    const sentToday = await getDailyCount(userId);
    const remaining = Math.max(0, DAILY_LIMIT - sentToday);
    const inWindow  =  true;
    const waitMs    = null;

    return res.json({
      success: true,
      data: {
        dailySent:      sentToday,
        dailyLimit:     DAILY_LIMIT,
        remaining,
        limitReached:   sentToday >= DAILY_LIMIT,
        withinWindow:   inWindow,
        windowResetsIn: null,
        windowResetsAt: null,
        percentUsed:    Math.min(100, Math.round((sentToday / DAILY_LIMIT) * 100)),
      },
    });
  } catch (err) {
    console.error("getDailyLimitStatus error:", err);
    return res.status(500).json({ success: false });
  }
};


export const getAdminDailyOverview = async (req, res) => {
  try {
    // ── 1. Role guard ────────────────────────────────────────────────────────
    // const role = String(req.user?.jobRole || "").trim().toLowerCase();
    // if (role !== "admin" && role !== "hr") {
    //   return res.status(403).json({ success: false, message: "Access denied" });
    // }
 
    // ── 2. All active users ──────────────────────────────────────────────────
    const users = await prisma.user.findMany({
      where:  { isActive: true },
      select: { id: true, name: true, empId: true, email: true, jobRole: true },
      orderBy: { name: "asc" },
    });
 
    // ── 3. IST-aware bucket start (same timezone-safe helper as getDailyCount) ──
    const bucketStart = getBucketStartUtc();
 
    // ── 4. Bulk-fetch DailyEmailLog rows for current bucket ──────────────────
    const logs = await prisma.dailyEmailLog.groupBy({
      by:    ["userId"],
      _sum:  { count: true },
      _max:  { sentAt: true },
      where: { sentAt: { gte: bucketStart } },
    });
 
    const logMap = {};
    for (const row of logs) {
      logMap[row.userId] = {
        sent:       row._sum.count || 0,
        lastSentAt: row._max.sentAt,
      };
    }
 
    // ── 5. Bulk-fetch active (sending) campaign counts per user ──────────────
    const sendingCampaigns = await prisma.campaign.groupBy({
      by:     ["userId"],
      _count: { id: true },
      where:  { status: "sending" },
    });
 
    const sendingMap = {};
    for (const row of sendingCampaigns) {
      sendingMap[row.userId] = row._count.id;
    }
 
    // ── 6. Build per-user rows ───────────────────────────────────────────────
    let totalSentToday = 0;
 
    const rows = users.map((u) => {
      const dailySent      = logMap[u.id]?.sent       || 0;
      const lastSentAt     = logMap[u.id]?.lastSentAt || null;
      const activeCampaigns = sendingMap[u.id]        || 0;
      const remaining      = Math.max(0, DAILY_LIMIT - dailySent);
      const percentUsed    = Math.min(100, Math.round((dailySent / DAILY_LIMIT) * 100));
 
      totalSentToday += dailySent;
 
      // status logic:
      // "sending"   → has at least one campaign currently sending
      // "completed" → hit/exceeded daily limit
      // "idle"      → sent nothing today
      // "active"    → sent some emails, no campaign running right now
      let status = "idle";
      if (activeCampaigns > 0)     status = "sending";
      else if (dailySent >= DAILY_LIMIT) status = "completed";
      else if (dailySent > 0)      status = "active";
 
      return {
        userId:          u.id,
        name:            u.name || u.email.split("@")[0],
        empId:           u.empId || "—",
        email:           u.email,
        jobRole:         String(u.jobRole || "EMP").trim(),
        dailySent,
        dailyLimit:      DAILY_LIMIT,
        remaining,
        percentUsed,
        status,
        activeCampaigns,
        lastSentAt,
      };
    });
 
    // Sort: sending first, then active, then idle
    const ORDER = { sending: 0, active: 1, completed: 2, idle: 3 };
    rows.sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.dailySent - a.dailySent);
 
    return res.json({
      success: true,
      data: {
        generatedAt:    new Date().toISOString(),
        totalSentToday,
        globalLimit:    DAILY_LIMIT * users.length,
        users:          rows,
      },
    });
 
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
      return res.status(400).json({ success: false, message: "Campaign name is required" });
    }
    if (!subjects?.length || !bodyHtml || !recipients?.length || !fromAccountIds?.length) {
      return res.status(400).json({
        success: false,
        message: "Subjects, body, recipients and from accounts are required",
      });
    }

    // 2️⃣ 🌐 Global daily limit + window check (immediate only)
    //    Scheduled campaigns are allowed to be created at any time —
    //    the service layer will wait automatically when they fire.
    if (sendType === "immediate") {
      const blocked = await checkGlobalSendingRules(req.user.id);
      if (blocked) return res.status(blocked.status).json(blocked.body);
    }

    // 3️⃣ Account lock check
    const sendingCampaigns = await prisma.campaign.findMany({
      where:   { status: "sending" },
      include: { recipients: { select: { accountId: true } } },
    });

    const locked = new Set();
    for (const campaign of sendingCampaigns) {
      try { JSON.parse(campaign.fromAccountIds || "[]").forEach(id => locked.add(Number(id))); } catch {}
      campaign.recipients.forEach(r => { if (r.accountId) locked.add(Number(r.accountId)); });
    }

    if (sendType === "immediate") {
      const conflict = fromAccountIds.find(id => locked.has(Number(id)));
      if (conflict) {
        return res.status(400).json({
          success: false,
          message: "This email account is already sending a campaign. Please wait until it completes.",
        });
      }
    }

    // 4️⃣ Provider limit / estimated completion
    const accounts = await prisma.emailAccount.findMany({ where: { id: { in: fromAccountIds } } });

    const SAFE_LIMITS = { gmail: 50, gsuite: 80, rediff: 40, amazon: 60, custom: 60 };
    let totalHourlyCapacity = 0;
    for (const acc of accounts) {
      const provider = (acc.provider || "custom").toLowerCase();
      let limit = SAFE_LIMITS[provider] || SAFE_LIMITS.custom;
      if (customLimits && customLimits[acc.id]) limit = customLimits[acc.id];
      totalHourlyCapacity += limit;
    }

    const hoursNeeded         = recipients.length / totalHourlyCapacity;
    const estimatedMs         = hoursNeeded * 60 * 60 * 1000;
    const estimatedCompletion = new Date(Date.now() + estimatedMs);

    if (recipients.length > totalHourlyCapacity) {
      console.log(`⚠️ Recipients (${recipients.length}) exceed hourly capacity (${totalHourlyCapacity}). Will send in batches.`);
    }

    // 5️⃣ Auto-unique campaign name
    let baseName  = campaignName.trim();
    let finalName = baseName;

    const existing = await prisma.campaign.findMany({
      where:  { userId: req.user.id, name: { startsWith: baseName } },
      select: { name: true },
    });
    const used = existing.map(c => c.name);
    if (used.includes(baseName)) {
      let i = 2;
      while (used.includes(`${baseName} (${i})`)) i++;
      finalName = `${baseName} (${i})`;
    }

    // 6️⃣ Schedule conflict check
    if (sendType === "scheduled" && scheduledAt) {
      const scheduledTime = new Date(scheduledAt);
      const windowStart   = new Date(scheduledTime.getTime() - 2 * 3_600_000);
      const windowEnd     = new Date(scheduledTime.getTime() + 2 * 3_600_000);

      const conflicting = await prisma.campaign.findMany({
        where: {
          OR:          [{ status: "scheduled" }, { status: "sending" }],
          scheduledAt: { gte: windowStart, lte: windowEnd },
        },
        select: { fromAccountIds: true },
      });

      const busyAccounts = new Set();
      for (const c of conflicting) {
        try { JSON.parse(c.fromAccountIds || "[]").forEach(id => busyAccounts.add(Number(id))); } catch {}
      }

      if (fromAccountIds.find(id => busyAccounts.has(Number(id)))) {
        return res.status(400).json({
          success: false,
          message: "This email account already has a campaign scheduled near this time. Choose another time or account.",
        });
      }
    }

    // 7️⃣ Create campaign + recipients
    const fromIds = fromAccountIds.map(Number);

    const campaign = await prisma.campaign.create({
      data: {
        userId:    req.user.id,
        name:      finalName,
        bodyHtml,
        sendType,
        estimatedCompletion,
        senderRole,
        scheduledAt:    sendType === "scheduled" ? new Date(scheduledAt) : null,
        status:         sendType === "scheduled" ? "scheduled" : "draft",
        subject:        JSON.stringify(subjects),
        fromAccountIds: JSON.stringify(fromAccountIds),
        pitchIds:       JSON.stringify(pitchIds || []),
        customLimits:   customLimits ? JSON.stringify(customLimits) : null,
        recipients: {
          create: (() => {
            const unique = [...new Set(recipients.map(e => e.trim().toLowerCase()))];
            return unique.map((email, i) => ({
              email,
              status:    "pending",
              accountId: fromIds[i % fromIds.length],
            }));
          })(),
        },
      },
    });

    // 8️⃣ Kick off sending for immediate campaigns
    if (campaign.sendType === "immediate") {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "sending" } });
      invalidateDashboardCache(req.user.id);

      const freshCampaign = await prisma.campaign.findUnique({ where: { id: campaign.id } });
      if (freshCampaign.status === "sending") {
        sendBulkCampaign(campaign.id).catch(err => {
          console.error(`Error in campaign ${campaign.id}:`, err);
        });
      }
    } else {
      invalidateDashboardCache(req.user.id);
    }

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

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    if (campaign.status === "sent") return res.json({ success: true });

    // 🌐 Global check
    const blocked = await checkGlobalSendingRules(campaign.userId);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    // Account lock check
    const activeCampaigns = await prisma.campaign.findMany({
      where: { status: "sending", NOT: { id: campaignId } },
    });

    const locked = new Set();
    for (const c of activeCampaigns) {
      try { JSON.parse(c.fromAccountIds || "[]").forEach(id => locked.add(Number(id))); } catch {}
    }

    const fromIds = JSON.parse(campaign.fromAccountIds || "[]");
    if (fromIds.find(id => locked.has(Number(id)))) {
      return res.status(400).json({
        success: false,
        message: "Email account is already used in another active campaign.",
      });
    }

    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "sending" } });
    invalidateDashboardCache(campaign.userId);

    sendBulkCampaign(campaignId).catch(err => {
      console.error(`Error sending campaign ${campaignId}:`, err);
    });

    return res.json({ success: true, message: "Campaign sending started" });

  } catch (err) {
    console.error("sendCampaignNow error:", err);
    return res.status(500).json({ success: false, message: "Failed to send campaign" });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   SCHEDULE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const scheduleCampaign = async (req, res) => {
  try {
    const campaignId    = Number(req.params.id);
    const { scheduledAt } = req.body;

    if (!scheduledAt) return res.status(400).json({ success: false, message: "Scheduled time is required" });

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    await prisma.campaign.update({
      where: { id: campaignId },
      data:  { scheduledAt: new Date(scheduledAt), status: "scheduled" },
    });

    invalidateDashboardCache(campaign.userId);
    return res.json({ success: true });

  } catch (err) {
    console.error("Schedule campaign error:", err);
    res.status(500).json({ success: false, message: "Failed to schedule campaign" });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   CREATE FOLLOW-UP CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const createFollowupCampaign = async (req, res) => {
  try {
    const { baseCampaignId, subjects, bodyHtml, senderRecipientMap } = req.body;

    if (!baseCampaignId || !senderRecipientMap) {
      return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    // 🌐 Global check
    const blocked = await checkGlobalSendingRules(req.user.id);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    const baseCampaign = await prisma.campaign.findUnique({
      where:  { id: baseCampaignId },
      select: {
        id: true, name: true, senderRole: true, customLimits: true,
        recipients: { select: { email: true, accountId: true } },
      },
    });

    if (!baseCampaign) return res.status(404).json({ success: false, message: "Base campaign not found" });

    const sendingCampaigns = await prisma.campaign.findMany({
      where:   { status: "sending" },
      include: { recipients: { select: { accountId: true } } },
    });

    const locked = new Set();
    for (const campaign of sendingCampaigns) {
      try { JSON.parse(campaign.fromAccountIds || "[]").forEach(id => locked.add(Number(id))); } catch {}
      campaign.recipients.forEach(r => { if (r.accountId) locked.add(Number(r.accountId)); });
    }

    let finalName = `${baseCampaign.name} (Followup)`;
    const existing = await prisma.campaign.findMany({
      where:  { userId: req.user.id, name: { startsWith: finalName } },
      select: { name: true },
    });
    const used = existing.map(c => c.name);
    if (used.includes(finalName)) {
      let i = 2;
      while (used.includes(`${finalName} (${i})`)) i++;
      finalName = `${finalName} (${i})`;
    }

    const followupCampaign = await prisma.campaign.create({
      data: {
        userId:           req.user.id,
        name:             finalName,
        subject:          JSON.stringify(subjects || []),
        bodyHtml:         bodyHtml || "",
        sendType:         "followup",
        status:           "draft",
        parentCampaignId: baseCampaignId,
        fromAccountIds:   JSON.stringify([]),
        pitchIds:         JSON.stringify([]),
        senderRole:       baseCampaign.senderRole || "",
        // ✅ Inherit rate limits from parent so follow-ups obey the same /hr setting
        customLimits:     baseCampaign.customLimits || null,
      },
    });

    const recipientCreates = [];

    for (const [senderId, emailArray] of Object.entries(senderRecipientMap)) {
      const accountId = Number(senderId);

      if (locked.has(accountId)) {
        await prisma.campaign.delete({ where: { id: followupCampaign.id } });
        return res.status(400).json({
          success: false,
          message: "One or more sender accounts are currently busy. Please wait.",
        });
      }

      for (const email of emailArray) {
        recipientCreates.push({
          campaignId:    followupCampaign.id,
          email,
          status:        "pending",
          accountId,
          sentBodyHtml:  "",
          sentSubject:   "",
          sentFromEmail: "",
        });
      }
    }

    await prisma.campaignRecipient.createMany({ data: recipientCreates });
    invalidateDashboardCache(req.user.id);

    return res.json({ success: true, data: followupCampaign });

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

    const campaign = await prisma.campaign.findUnique({
      where:  { id: campaignId },
      select: { userId: true, status: true },
    });

    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    // 🌐 Global check
    const blocked = await checkGlobalSendingRules(campaign.userId);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "sending" } });

    sendBulkCampaign(campaignId).catch(err => {
      console.error(`Error sending follow-up campaign ${campaignId}:`, err);
    });

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
        where:  { userId: req.user.id },
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
      where:   { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, status: true, sendType: true,
        subject: true, fromAccountIds: true,
        parentCampaignId: true, createdAt: true, estimatedCompletion: true,
      },
    });

    const counts = await getRecipientCounts(campaigns.map(c => c.id));

    const result = campaigns.map(c => {
      const k = counts[c.id] || { total: 0, sent: 0, pending: 0, processing: 0, failed: 0, lastSentAt: null };
      return {
        ...c,
        // ⚠ FRONTEND: campaign.recipients is gone — use these instead of
        // campaign.recipients.length / .filter(...).length
        recipientCount: k.total,
        sentCount:      k.sent,
        pendingCount:   k.pending + k.processing,
        failedCount:    k.failed,
        lastSentAt:     k.lastSentAt,
      };
    });

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
    let endDate   = null;
    const now     = new Date();

    if (range === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate   = new Date();
    } else if (range === "week") {
      const firstDay = new Date(now);
      firstDay.setDate(now.getDate() - now.getDay());
      firstDay.setHours(0, 0, 0, 0);
      startDate = firstDay;
      endDate   = new Date();
    } else if (range === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate   = new Date();
    }
    if (date) {
      const d = new Date(date);
      startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      endDate   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
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
          id: true, name: true, status: true, sendType: true, subject: true,
          createdAt: true, scheduledAt: true, estimatedCompletion: true,
          parentCampaignId: true, fromAccountIds: true,
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

    const followupIds    = new Set(allInRange.filter(c => c.sendType === "followup").map(c => c.id));
    const totalFollowups = followupIds.size;
    const totalCampaigns = allInRange.length - totalFollowups;

    const statRows = allInRange.length
      ? await prisma.campaignRecipient.groupBy({
          by:     ["campaignId", "status"],
          where:  { campaignId: { in: allInRange.map(c => c.id) } },
          _count: { _all: true },
        })
      : [];

    let totalRecipients = 0, sentRecipients = 0,
        pendingRecipients = 0, failedRecipients = 0, followupEmails = 0;

    for (const row of statRows) {
      const n = row._count._all;
      if (followupIds.has(row.campaignId)) {
        followupEmails += n;
        continue;
      }
      totalRecipients += n;
      if      (row.status === "sent")   sentRecipients    += n;
      else if (row.status === "failed") failedRecipients  += n;
      else if (row.status === "pending" || row.status === "processing") pendingRecipients += n;
    }

    /* -- 3. per-row counts for the visible page only ------------------------ */
    const counts = await getRecipientCounts(campaigns.map(c => c.id));

    /* -- 4. sender labels --------------------------------------------------- */
    const accountIds = new Set();
    for (const c of campaigns) {
      try {
        JSON.parse(c.fromAccountIds || "[]").forEach(id => accountIds.add(Number(id)));
      } catch { /* malformed JSON on this row — skip */ }
    }

    let accountEmailMap = {};
    if (accountIds.size > 0) {
      const allAccounts = await prisma.emailAccount.findMany({
        where:  { id: { in: Array.from(accountIds) } },
        select: { id: true, email: true },
      });
      allAccounts.forEach(acc => { accountEmailMap[acc.id] = acc.email.split("@")[0] + "@"; });
    }

    const recentCampaigns = campaigns.map(campaign => {
      let fromNames = [];
      try {
        fromNames = JSON.parse(campaign.fromAccountIds || "[]")
          .map(id => accountEmailMap[Number(id)])
          .filter(Boolean);
      } catch { /* ignore */ }

      const k = counts[campaign.id] || { total: 0, sent: 0, pending: 0, processing: 0, failed: 0, lastSentAt: null };
      return {
        ...campaign,
        fromNames,
        // ⚠ FRONTEND: campaign.recipients is no longer returned. Use these.
        recipientCount: k.total,
        sentCount:      k.sent,
        pendingCount:   k.pending + k.processing,
        failedCount:    k.failed,
        lastSentAt:     k.lastSentAt,
      };
    });

    const responseData = {
      stats: {
        totalCampaigns, totalRecipients, sentRecipients,
        pendingRecipients, failedRecipients, totalFollowups, followupEmails,
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
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }

    // Short micro-cache: this endpoint is polled every 5s per expanded row,
    // so concurrent pollers within the same tick collapse to one query.
    const cacheKey = `progress:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    // Ownership check — this route previously had no `protect` at all.
    const campaign = await prisma.campaign.findFirst({
      where:  { id, userId: req.user.id },
      select: { id: true, customLimits: true },
    });
    if (!campaign) return res.status(404).json({ success: false });

    let customLimits = {};
    try {
      if (campaign.customLimits) customLimits = JSON.parse(campaign.customLimits);
    } catch { /* malformed — fall back to provider defaults */ }

    /* ⚡ OPTIMISED: was `include: { recipients: true }`, which pulled every
       column of every recipient row — including sentBodyHtml, the full
       rendered email — every 5 seconds. Now one grouped count.            */
    const [grouped, ipRows] = await Promise.all([
      prisma.campaignRecipient.groupBy({
        by:     ["accountId", "status"],
        where:  { campaignId: id, accountId: { not: null } },
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

    const accountIds = [...new Set(grouped.map(g => g.accountId))];
    const accounts   = await prisma.emailAccount.findMany({
      where:  { id: { in: accountIds } },
      select: { id: true, email: true, provider: true },
    });

    const byId  = Object.fromEntries(accounts.map(a => [a.id, a]));
    const ipMap = Object.fromEntries(ipRows.map(r => [r.accountId, r.sendingIp]));

    const rows = {};
    for (const g of grouped) {
      const account = byId[g.accountId];
      if (!account) continue;

      if (!rows[account.id]) {
        rows[account.id] = {
          email:      account.email,
          domain:     account.provider,
          processing: 0,
          completed:  0,
          failed:     0,
          sendingIp:  ipMap[account.id] || null,
          eta:        "0m",
        };
      }

      const n = g._count._all;
      if      (g.status === "sent")   rows[account.id].completed  += n;
      else if (g.status === "failed") rows[account.id].failed     += n;
      else if (g.status === "pending" || g.status === "processing") rows[account.id].processing += n;
    }

    for (const [accId, row] of Object.entries(rows)) {
      const provider = (row.domain || "custom").toLowerCase();
      const limit    = customLimits[accId] || SAFE_LIMITS[provider] || SAFE_LIMITS.custom;
      row.eta = row.processing === 0
        ? "Done"
        : formatDuration((row.processing / limit) * 3_600_000);
    }

    const result = Object.values(rows);
    cache.set(cacheKey, result, 4);
    return res.json({ success: true, data: result });

  } catch (err) {
    console.error("Progress API error:", err);
    return res.status(500).json({ success: false });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   GET LOCKED ACCOUNTS
═══════════════════════════════════════════════════════════════════════════ */
export const getLockedAccounts = async (req, res) => {
  try {
    const cacheKey = `locked:${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    // ⚡ OPTIMISED: previously loaded every `sending` campaign WITH all of its
    // recipient rows just to collect account ids. Now two narrow queries.
    const sendingCampaigns = await prisma.campaign.findMany({
      where:  { status: "sending" },
      select: { fromAccountIds: true },
    });

    const busy = new Set();
    for (const c of sendingCampaigns) {
      try {
        JSON.parse(c.fromAccountIds || "[]").forEach(id => busy.add(Number(id)));
      } catch { /* malformed JSON on this row — skip */ }
    }

    const assigned = await prisma.campaignRecipient.findMany({
      where:    { campaign: { status: "sending" }, accountId: { not: null } },
      select:   { accountId: true },
      distinct: ["accountId"],
    });
    assigned.forEach(r => busy.add(Number(r.accountId)));

    const result = { busy: Array.from(busy) };
    cache.set(cacheKey, result, 10);
    return res.json({ success: true, data: result });

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

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    await prisma.campaignRecipient.deleteMany({ where: { campaignId } });
    await prisma.campaign.delete({ where: { id: campaignId } });

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
    const level  = Math.min(Math.max(Number(req.query.level) || 1, 1), 4);
    const limit  = Math.min(Math.max(Number(req.query.limit) || 6, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const cacheKey = `forFollowup:${userId}:${level}:${offset}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[for-followup] CACHE HIT in ${Date.now() - t0}ms`);
      return res.json({ success: true, data: cached.items, ...cached });
    }

    /* ── ONE query for every campaign this user owns ─────────────────────
       Was two separate findMany calls (base campaigns + follow-ups).
       The select is deliberately tiny — no bodyHtml, no recipients — so
       even a few hundred rows is a small result set.                     */
    const tQuery = Date.now();
    const all = await prisma.campaign.findMany({
      where:   { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, status: true, sendType: true, subject: true,
        createdAt: true, fromAccountIds: true, parentCampaignId: true,
        estimatedCompletion: true,
      },
    });
    mark.campaigns = Date.now() - tQuery;
    mark.campaignRows = all.length;

    /* ── Partition in memory (microseconds, no DB round trip) ─────────── */
    const activeParents  = new Set();
    const completedCount = {};
    const baseCampaigns  = [];

    for (const c of all) {
      if (c.sendType === "followup" && c.parentCampaignId) {
        if (c.status === "completed") {
          completedCount[c.parentCampaignId] = (completedCount[c.parentCampaignId] || 0) + 1;
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

    const eligible = baseCampaigns.filter(c => {
      if (activeParents.has(c.id)) return false;
      const done = completedCount[c.id] || 0;
      return done < 4 && done === level - 1;
    });
    mark.eligible = eligible.length;

    /* ── Page the eligible list ───────────────────────────────────────────
       Slicing happens AFTER filtering — eligibility depends on the whole
       set, so it cannot be pushed into the SQL LIMIT. What this does save
       is the count query below, which now covers only the visible page.  */
    const total   = eligible.length;
    const pageRows = eligible.slice(offset, offset + limit);
    const hasMore  = offset + limit < total;
    mark.total_eligible = total;
    mark.returned = pageRows.length;

    if (pageRows.length === 0) {
      const empty = { items: [], total, hasMore: false, offset, limit };
      cache.set(cacheKey, empty, 20);
      console.log(`[for-followup] ${Date.now() - t0}ms total`, mark);
      return res.json({ success: true, data: [], ...empty });
    }

    /* ── Sent counts, only for the rows actually being returned ────────── */
    const tCounts = Date.now();
    const sentRows = await prisma.campaignRecipient.groupBy({
      by:     ["campaignId"],
      where:  { campaignId: { in: pageRows.map(c => c.id) }, status: "sent" },
      _count: { _all: true },
    });
    mark.counts = Date.now() - tCounts;

    const sentMap = Object.fromEntries(sentRows.map(r => [r.campaignId, r._count._all]));

    const data = pageRows.map(c => ({
      ...c,
      sentCount:      sentMap[c.id] || 0,
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
    console.log(`[for-followup] ${elapsed}ms`, mark);

    return res.json({ success: true, data, total, hasMore, offset, limit, _timing: mark });

  } catch (err) {
    console.error("Get campaigns for followup error:", err, "after", Date.now() - t0, "ms");
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   GET SINGLE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const getSingleCampaign = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }

    const { status, page = "1", pageSize = "200", search } = req.query;
    const take = Math.min(Number(pageSize) || 200, 500);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    // Ownership check — previously any authenticated user could read any campaign.
    const campaign = await prisma.campaign.findFirst({
      where:  { id, userId: req.user.id },
      select: {
        id: true, name: true, status: true, sendType: true, subject: true,
        createdAt: true, scheduledAt: true, estimatedCompletion: true,
        fromAccountIds: true, parentCampaignId: true,
        // Single campaign only — safe to include the template here. It is
        // deliberately NOT selected in the list endpoints, where it would be
        // multiplied by every campaign on the page.
        bodyHtml: true, originalBodyHtml: true, senderRole: true,
      },
    });
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    /* ⚡ Stats from a grouped count: 4 rows instead of every recipient. */
    const grouped = await prisma.campaignRecipient.groupBy({
      by:     ["status"],
      where:  { campaignId: id },
      _count: { _all: true },
    });

    const raw = { sent: 0, pending: 0, processing: 0, failed: 0 };
    for (const g of grouped) {
      if (raw[g.status] !== undefined) raw[g.status] += g._count._all;
    }

    const stats = {
      total:      grouped.reduce((s, g) => s + g._count._all, 0),
      // `processing` now includes in-flight rows, matching the modal's own
      // copy filter (pending || processing). Previously only `pending` was
      // counted here, so total !== processing + completed + failed whenever
      // rows were mid-send.
      processing: raw.pending + raw.processing,
      completed:  raw.sent,
      failed:     raw.failed,
    };

    /* ⚡ Recipients: paginated, and sentBodyHtml is NOT selected. That field
       holds the entire rendered email per row, and was the bulk of the
       old multi-megabyte response. Fetch one on demand via
       GET /:id/recipients/:recipientId/body                              */
    const statusFilter =
      status === "completed"  ? { status: "sent" }
    : status === "processing" ? { status: { in: ["pending", "processing"] } }
    : status === "failed"     ? { status: "failed" }
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
        id: true, email: true, status: true, accountId: true,
        sentAt: true, sentSubject: true, sentFromEmail: true,
        sendingIp: true, error: true,
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
    const campaignId  = Number(req.params.id);
    const recipientId = Number(req.params.recipientId);

    if (!Number.isInteger(campaignId) || !Number.isInteger(recipientId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const row = await prisma.campaignRecipient.findFirst({
      where: {
        id:         recipientId,
        campaignId,
        campaign:   { userId: req.user.id },
      },
      select: {
        id: true, email: true, sentSubject: true,
        sentFromEmail: true, sentBodyHtml: true, sentAt: true,
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
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }

    const owns = await prisma.campaign.findFirst({
      where:  { id, userId: req.user.id },
      select: { id: true },
    });
    if (!owns) return res.status(404).json({ success: false, message: "Campaign not found" });

    const { status } = req.query;
    const statusFilter =
      status === "sent" || status === "completed" ? { status: "sent" }
    : status === "processing" ? { status: { in: ["pending", "processing"] } }
    : status === "failed"     ? { status: "failed" }
    : {};

    const recipients = await prisma.campaignRecipient.findMany({
      where:   { campaignId: id, ...statusFilter },
      orderBy: { id: "asc" },
      select:  { id: true, email: true, accountId: true, status: true },
    });

    return res.json({ success: true, data: recipients, count: recipients.length });

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

    if (!campaignId) return res.status(400).json({ success: false, message: "Invalid campaign id" });

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, userId: req.user.id },
    });

    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    if (campaign.status !== "sending") {
      return res.status(400).json({
        success: false,
        message: `Cannot stop campaign with status: ${campaign.status}`,
      });
    }

    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "stopped" } });
    invalidateDashboardCache(req.user.id);

    return res.json({ success: true, message: "Campaign stopped successfully" });

  } catch (err) {
    console.error("Stop campaign error:", err);
    return res.status(500).json({ success: false, message: "Failed to stop campaign" });
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
export const resendCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId) return res.status(400).json({ success: false, message: "Invalid campaign id" });

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, userId: req.user.id },
    });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    if (campaign.status !== "stopped") {
      return res.status(400).json({
        success: false,
        message: `Cannot resend campaign with status: ${campaign.status}`,
      });
    }

    // 🌐 Global daily-limit check
    const blocked = await checkGlobalSendingRules(campaign.userId);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    // Nothing left to send? Don't spin up a worker for zero recipients —
    // just tell the user so instead of silently no-op-ing.
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId, status: "pending" },
    });
    if (remaining === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending recipients left — every recipient has already been sent to (or failed permanently).",
      });
    }

    // Account lock check — same guard as sendCampaignNow, so a resumed
    // campaign can't grab a sending account another active campaign is using.
    const activeCampaigns = await prisma.campaign.findMany({
      where: { status: "sending", NOT: { id: campaignId } },
    });
    const locked = new Set();
    for (const c of activeCampaigns) {
      try { JSON.parse(c.fromAccountIds || "[]").forEach(id => locked.add(Number(id))); } catch {}
    }
    const fromIds = JSON.parse(campaign.fromAccountIds || "[]");
    if (fromIds.find(id => locked.has(Number(id)))) {
      return res.status(400).json({
        success: false,
        message: "Email account is already used in another active campaign.",
      });
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data:  { status: "sending", error: null },
    });
    invalidateDashboardCache(campaign.userId);

    sendBulkCampaign(campaignId).catch(err => {
      console.error(`Error resending campaign ${campaignId}:`, err);
    });

    return res.json({
      success: true,
      message: `Campaign resumed — ${remaining} recipient(s) remaining`,
    });

  } catch (err) {
    console.error("Resend campaign error:", err);
    return res.status(500).json({ success: false, message: "Failed to resend campaign" });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE FOLLOWUP RECIPIENTS
═══════════════════════════════════════════════════════════════════════════ */
export const updateFollowupRecipients = async (req, res) => {
  try {
    const { campaignId, deletedRecipientIds } = req.body;

    if (!campaignId || !Array.isArray(deletedRecipientIds)) {
      return res.status(400).json({ success: false, message: "Invalid payload: campaignId and deletedRecipientIds array required" });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: Number(campaignId), userId: req.user.id },
    });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found or access denied" });

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

    return res.json({ success: true, message: `Removed ${result.count} recipient(s)` });

  } catch (err) {
    console.error("Update followup recipients error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to update recipients" });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   FOLLOWUP CLEANUP JOB
═══════════════════════════════════════════════════════════════════════════ */
export const startFollowupCleanupJob = () => {
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY  = 24 * ONE_HOUR;

  setInterval(async () => {
    try {
      const oneDayAgo = new Date(Date.now() - ONE_DAY);

      const allFollowups = await prisma.campaign.findMany({
        where: {
          sendType:         "followup",
          status:           "completed",
          parentCampaignId: { not: null },
          createdAt:        { lte: oneDayAgo },
        },
        select: { id: true, parentCampaignId: true, userId: true },
      });

      const countPerParent = {};
      allFollowups.forEach(f => {
        countPerParent[f.parentCampaignId] = (countPerParent[f.parentCampaignId] || 0) + 1;
      });

      const toDelete = allFollowups.filter(f => countPerParent[f.parentCampaignId] >= 4);

      for (const campaign of toDelete) {
        await prisma.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
        await prisma.campaign.delete({ where: { id: campaign.id } });
        invalidateDashboardCache(campaign.userId);
        console.log(`🗑️ Auto-deleted old followup campaign ${campaign.id}`);
      }

    } catch (err) {
      console.error("Followup cleanup job error:", err);
    }
  }, ONE_HOUR);

  console.log("✅ Follow-up cleanup job started");
};