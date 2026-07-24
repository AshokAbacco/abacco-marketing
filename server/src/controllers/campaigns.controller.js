// campaigns.controller.js — Full file with Global Daily Limit (5 PM reset) + all original exports

import prisma from "../prisma.js";
import {
  sendBulkCampaign,
  getDailyCount,
 
  
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
 
    // ── 3. IST-aware bucket start (same logic as getDailyCount) ──────────────
    const nowIST = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );
    const resetToday = new Date(nowIST);
    resetToday.setHours(17, 0, 0, 0);
 
    const bucketStart =
      nowIST < resetToday
        ? new Date(resetToday.getTime() - 24 * 60 * 60 * 1000)
        : resetToday;
 
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
    const cacheKey = `allCampaigns:${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: getAllCampaigns");
      return res.json({ success: true, data: cached });
    }

    const campaigns = await prisma.campaign.findMany({
      where:   { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, status: true, sendType: true,
        subject: true, bodyHtml: true, fromAccountIds: true,
        parentCampaignId: true, createdAt: true, estimatedCompletion: true,
        recipients: {
          select: { id: true, email: true, status: true, accountId: true, sentAt: true },
        },
      },
    });

    cache.set(cacheKey, campaigns, 20);
    return res.json({ success: true, data: campaigns });

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
    const { range = "all", date } = req.query;

    const cacheKey = date
      ? `dashboard:${req.user.id}:${date}`
      : `dashboard:${req.user.id}:${range}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: getDashboardCampaigns");
      return res.json({ success: true, data: cached });
    }

    let startDate = null;
    let endDate   = null;
    const now     = new Date();

    if (range === "today") {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate   = new Date();
    }
    if (range === "week") {
      const firstDay = new Date();
      firstDay.setDate(now.getDate() - now.getDay());
      firstDay.setHours(0, 0, 0, 0);
      startDate = firstDay;
      endDate   = new Date();
    }
    if (range === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate   = new Date();
    }
    if (date) {
      const d = new Date(date);
      startDate = new Date(d.setHours(0, 0, 0, 0));
      endDate   = new Date(d.setHours(23, 59, 59, 999));
    }

    const where = {
      userId: req.user.id,
      ...(startDate && { createdAt: { gte: startDate, lte: endDate } }),
    };

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        recipients: {
          select: { id: true, email: true, status: true, accountId: true, sentAt: true },
        },
      },
    });

    const totalCampaigns = campaigns.filter(c => c.sendType !== "followup").length;
    const followups      = campaigns.filter(c => c.sendType === "followup");
    const totalFollowups = followups.length;
    const followupEmails = followups.reduce((sum, c) => sum + (c.recipients?.length || 0), 0);

    let totalRecipients = 0, sentRecipients = 0, pendingRecipients = 0, failedRecipients = 0;
    campaigns.forEach(campaign => {
      if (campaign.sendType === "followup") return;
      campaign.recipients?.forEach(r => {
        totalRecipients++;
        if (r.status === "sent")         sentRecipients++;
        else if (r.status === "pending") pendingRecipients++;
        else if (r.status === "failed")  failedRecipients++;
      });
    });

    const allAccountIds = new Set();
    for (const campaign of campaigns) {
      try { JSON.parse(campaign.fromAccountIds || "[]").forEach(id => allAccountIds.add(Number(id))); } catch {}
    }

    let accountEmailMap = {};
    if (allAccountIds.size > 0) {
      const allAccounts = await prisma.emailAccount.findMany({
        where:  { id: { in: Array.from(allAccountIds) } },
        select: { id: true, email: true },
      });
      allAccounts.forEach(acc => { accountEmailMap[acc.id] = acc.email.split("@")[0] + "@"; });
    }

    const recentCampaigns = campaigns.map(campaign => {
      let fromNames = [];
      try {
        const ids = JSON.parse(campaign.fromAccountIds || "[]");
        fromNames = ids.map(id => accountEmailMap[Number(id)]).filter(Boolean);
      } catch {}
      return { ...campaign, fromNames };
    });

    const responseData = {
      stats: {
        totalCampaigns, totalRecipients, sentRecipients,
        pendingRecipients, failedRecipients, totalFollowups, followupEmails,
      },
      recentCampaigns,
    };

    cache.set(cacheKey, responseData, 30);
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

    const campaign = await prisma.campaign.findUnique({
      where:   { id },
      include: { recipients: true },
    });

    if (!campaign) return res.status(404).json({ success: false });

    let customLimits = {};
    if (campaign.customLimits) {
      try { customLimits = JSON.parse(campaign.customLimits); } catch {}
    }

    const SAFE_LIMITS = { gmail: 50, gsuite: 80, rediff: 40, amazon: 60, custom: 60 };

    function formatDuration(ms) {
      const totalMinutes = Math.ceil(ms / 60000);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }

    const accountIds = [...new Set(campaign.recipients.map(r => r.accountId).filter(Boolean))];
    const accounts   = await prisma.emailAccount.findMany({ where: { id: { in: accountIds } } });

    const accountMap = {};
    accounts.forEach(acc => { accountMap[acc.id] = acc; });

    const grouped = {};
    for (const r of campaign.recipients) {
      if (!r.accountId) continue;
      const account = accountMap[r.accountId];
      if (!account) continue;
      const key = account.email;
      if (!grouped[key]) {
        grouped[key] = { email: account.email, domain: account.provider, processing: 0, completed: 0, sendingIp: null, eta: "0m" };
      }
      if (r.status === "pending") grouped[key].processing++;
      if (r.status === "sent")    grouped[key].completed++;
      if (r.sendingIp && !grouped[key].sendingIp) grouped[key].sendingIp = r.sendingIp;
    }

    for (const row of Object.values(grouped)) {
      const provider = (row.domain || "custom").toLowerCase();
      let limit = SAFE_LIMITS[provider] || SAFE_LIMITS.custom;
      const acc = accounts.find(a => a.email === row.email);
      if (acc && customLimits[acc.id]) limit = customLimits[acc.id];
      const remainingMsNeeded = (row.processing / limit) * 3_600_000;
      row.eta = row.processing === 0 ? "Done" : formatDuration(remainingMsNeeded);
    }

    return res.json({ success: true, data: Object.values(grouped) });

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
    if (cached) {
      console.log("🟢 CACHE HIT: getLockedAccounts");
      return res.json({ success: true, data: cached });
    }

    const sendingCampaigns = await prisma.campaign.findMany({
      where:   { status: "sending" },
      include: { recipients: { select: { accountId: true } } },
    });

    const busy = new Set();
    for (const campaign of sendingCampaigns) {
      try { JSON.parse(campaign.fromAccountIds || "[]").forEach(id => busy.add(Number(id))); } catch {}
      campaign.recipients.forEach(r => { if (r.accountId) busy.add(Number(r.accountId)); });
    }

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
  try {
    const allCampaigns = await prisma.campaign.findMany({
      where: {
        userId:           req.user.id,
        OR:               [{ sendType: "immediate" }, { sendType: "scheduled" }],
        status:           "completed",
        parentCampaignId: null,
      },
      include:  { recipients: true },
      orderBy:  { createdAt: "desc" },
    });

    const activeFollowups = await prisma.campaign.findMany({
      where: {
        userId:           req.user.id,
        sendType:         "followup",
        status:           { in: ["draft", "sending", "scheduled"] },
        parentCampaignId: { not: null },
      },
      select: { parentCampaignId: true },
    });

    const campaignsWithActiveFollowups = new Set(activeFollowups.map(f => f.parentCampaignId));

    const completedFollowups = await prisma.campaign.findMany({
      where: {
        userId:           req.user.id,
        sendType:         "followup",
        status:           "completed",
        parentCampaignId: { not: null },
      },
      select: { parentCampaignId: true },
    });

    const followupCountMap = {};
    completedFollowups.forEach(f => {
      followupCountMap[f.parentCampaignId] = (followupCountMap[f.parentCampaignId] || 0) + 1;
    });

    const availableCampaigns = allCampaigns.filter(c =>
      !campaignsWithActiveFollowups.has(c.id) &&
      (followupCountMap[c.id] || 0) < 4
    );

    return res.json({ success: true, data: availableCampaigns });

  } catch (err) {
    console.error("Get campaigns for followup error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   GET SINGLE CAMPAIGN
═══════════════════════════════════════════════════════════════════════════ */
export const getSingleCampaign = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where:   { id },
      include: {
        recipients: {
          select: {
            id: true, email: true, status: true, accountId: true,
            sentAt: true, sentSubject: true, sentFromEmail: true,
            sentBodyHtml: true, sendingIp: true,
          },
        },
      },
    });

    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    const total      = campaign.recipients.length;
    const processing = campaign.recipients.filter(r => r.status === "pending").length;
    const completed  = campaign.recipients.filter(r => r.status === "sent").length;
    const failed     = campaign.recipients.filter(r => r.status === "failed").length;

    return res.json({
      success: true,
      data: { campaign, stats: { total, processing, completed, failed } },
    });

  } catch (err) {
    console.error("Get single campaign error:", err);
    res.status(500).json({ success: false });
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
   UPDATE FOLLOWUP RECIPIENTS
═══════════════════════════════════════════════════════════════════════════ */
export const updateFollowupRecipients = async (req, res) => {
  try {
    const { campaignId, recipients } = req.body;

    if (!campaignId || !Array.isArray(recipients)) {
      return res.status(400).json({ success: false, message: "Invalid payload: campaignId and recipients array required" });
    }
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, message: "Cannot save empty recipient list" });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: Number(campaignId), userId: req.user.id },
    });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found or access denied" });

    // Only touch rows that were actually editable in the modal (sent/completed),
    // so pending/failed recipients are never wiped out.
    await prisma.$transaction([
      prisma.campaignRecipient.deleteMany({
        where: { campaignId: Number(campaignId), status: { in: ["sent", "completed"] } },
      }),
      prisma.campaignRecipient.createMany({
        data: recipients.map(r => ({
          campaignId:    Number(campaignId),
          email:         r.email,
          status:        r.status || "pending",
          accountId:     r.accountId ? Number(r.accountId) : null,
          sentBodyHtml:  r.sentBodyHtml  || "",
          sentSubject:   r.sentSubject   || "",
          sentFromEmail: r.sentFromEmail || "",
        })),
      }),
    ]);

    return res.json({ success: true, message: `Successfully updated ${recipients.length} recipients` });

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