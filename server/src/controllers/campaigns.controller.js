import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";
import cache from "../utils/cache.js";

/**
 * Helper function to invalidate all dashboard caches
 */
const invalidateDashboardCache = (userId) => {
  // Invalidate all possible dashboard cache keys
  const ranges = ['today', 'week', 'month'];
  ranges.forEach(range => {
    cache.del(`dashboard:${userId}:${range}`);
  });
  
  // Also invalidate date-specific caches (clear all user caches)
  const keys = cache.keys();
  keys.forEach(key => {
    if (key.startsWith(`dashboard:${userId}:`)) {
      cache.del(key);
    }
  });
  
  // Invalidate locked accounts cache
  cache.del(`locked:${userId}`);
};

/**
 * Create Campaign
 */
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
      customLimits
    } = req.body;

    // 1️⃣ Basic validation
    if (!campaignName || !campaignName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }

    if (
      !subjects?.length ||
      !bodyHtml ||
      !recipients?.length ||
      !fromAccountIds?.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Subjects, body, recipients and from accounts are required",
      });
    }

    // 2️⃣ 🔒 LOCK CHECK (prevent using busy accounts)
    const sendingCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    if (sendType === "immediate") {
      const conflict = fromAccountIds.find(id => locked.has(Number(id)));

      if (conflict) {
        return res.status(400).json({
          success: false,
          message: "This email account is already sending a campaign. Please wait until it is completed."
        });
      }
    }

    // 3️⃣ PROVIDER LIMIT VALIDATION (SAFE SENDING) - Now supporting custom limits
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: fromAccountIds } }
    });

    const SAFE_LIMITS = {
      gmail: 50,
      gsuite: 80,
      rediff: 40,
      amazon: 60,
      custom: 60
    };

    let totalCapacity = 0;

    for (const acc of accounts) {
      const key = (acc.provider || "custom").toLowerCase();
      
      let limit = SAFE_LIMITS[key] || SAFE_LIMITS.custom;
      
      if (customLimits && customLimits[acc.id]) {
        limit = customLimits[acc.id];
      }
      
      totalCapacity += limit;
    }

    if (recipients.length > totalCapacity) {
      console.log(`⚠️ Recipients (${recipients.length}) exceed hourly capacity (${totalCapacity}). Will send in batches.`);
    }

    // 4️⃣ Auto-generate unique campaign name
    let baseName = campaignName.trim();
    let finalName = baseName;

    const existing = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        name: { startsWith: baseName },
      },
      select: { name: true },
    });

    const used = existing.map(c => c.name);

    if (used.includes(baseName)) {
      let i = 2;
      while (used.includes(`${baseName} (${i})`)) {
        i++;
      }
      finalName = `${baseName} (${i})`;
    }

    // 2.5️⃣ SCHEDULE CONFLICT CHECK
    if (sendType === "scheduled" && scheduledAt) {
      const scheduledTime = new Date(scheduledAt);

      const windowStart = new Date(scheduledTime.getTime() - (2 * 60 * 60 * 1000));
      const windowEnd   = new Date(scheduledTime.getTime() + (2 * 60 * 60 * 1000));

      const conflicting = await prisma.campaign.findMany({
        where: {
          OR: [
            { status: "scheduled" },
            { status: "sending" }
          ],
          scheduledAt: {
            gte: windowStart,
            lte: windowEnd
          }
        },
        select: {
          fromAccountIds: true
        }
      });

      const busyAccounts = new Set();

      for (const c of conflicting) {
        try {
          JSON.parse(c.fromAccountIds || "[]")
            .forEach(id => busyAccounts.add(Number(id)));
        } catch {}
      }

      const conflict = fromAccountIds.find(id => busyAccounts.has(Number(id)));

      if (conflict) {
        return res.status(400).json({
          success: false,
          message: "This email account already has another campaign scheduled near this time. Choose another time or account give after 2 hours let."
        });
      }
    }

    // 5️⃣ Create campaign
    const fromIds = fromAccountIds.map(Number);

    const campaign = await prisma.campaign.create({
        data: {
          userId: req.user.id,
          name: finalName,
          bodyHtml,
          sendType,

          // 🔥 FIXED LINE
          scheduledAt:
            sendType === "immediate"
              ? new Date()
              : new Date(scheduledAt),

          status: "scheduled",

          subject: JSON.stringify(subjects),
          fromAccountIds: JSON.stringify(fromAccountIds),
          pitchIds: JSON.stringify(pitchIds || []),
          customLimits: customLimits ? JSON.stringify(customLimits) : null,

          recipients: {
            create: recipients.map((email, i) => ({
              email,
              status: "pending",
              accountId: fromIds[i % fromIds.length],
            })),
          },
        },
    });


    // 🔥 INVALIDATE CACHE after creating campaign
    invalidateDashboardCache(req.user.id);

    return res.json({
      success: true,
      data: campaign,
    });

  } catch (err) {
    console.error("Create campaign error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Send Immediately
 */
export const sendCampaignNow = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    // ❌ Already sending
    if (campaign.status === "sending") {
      return res.status(400).json({
        success: false,
        message: "Campaign is already sending"
      });
    }

    // 🔒 LOCK CHECK (same as before)
    const activeCampaigns = await prisma.campaign.findMany({
      where: {
        status: "sending",
        NOT: { id: campaignId }
      }
    });

    const locked = new Set();

    for (const c of activeCampaigns) {
      try {
        JSON.parse(c.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}
    }

    const fromIds = JSON.parse(campaign.fromAccountIds || "[]");
    const conflict = fromIds.find(id => locked.has(Number(id)));

    if (conflict) {
      return res.status(400).json({
        success: false,
        message: "Email account is already used in another campaign"
      });
    }

    // ✅ KEY FIX: Queue as scheduled = NOW
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "scheduled",
        scheduledAt: new Date()
      }
    });

    // 🔥 Invalidate dashboard cache
    invalidateDashboardCache(campaign.userId);

    return res.json({
      success: true,
      message: "Campaign queued and will start immediately"
    });

  } catch (err) {
    console.error("Send campaign error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send campaign"
    });
  }
};

/**
 * Schedule Campaign
 */
export const scheduleCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({
        success: false,
        message: "Scheduled time is required"
      });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        scheduledAt: new Date(scheduledAt),
        status: "scheduled"
      }
    });

    // 🔥 INVALIDATE CACHE
    invalidateDashboardCache(campaign.userId);

    return res.json({ success: true });

  } catch (err) {
    console.error("Schedule campaign error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to schedule campaign"
    });
  }
};

export const createFollowupCampaign = async (req, res) => {
  try {
    const { baseCampaignId, subjects, bodyHtml, senderRecipientMap } = req.body;

    if (!baseCampaignId || !senderRecipientMap) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload"
      });
    }

    const baseCampaign = await prisma.campaign.findUnique({
      where: { id: baseCampaignId },
      include: { recipients: true }
    });

    if (!baseCampaign) {
      return res.status(404).json({
        success: false,
        message: "Base campaign not found"
      });
    }

    const sendingCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    let finalName = `${baseCampaign.name} (Followup)`;

    const existing = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        name: { startsWith: finalName }
      },
      select: { name: true }
    });

    const used = existing.map(c => c.name);

    if (used.includes(finalName)) {
      let i = 2;
      while (used.includes(`${finalName} (${i})`)) {
        i++;
      }
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
        parentCampaignId: baseCampaignId,
        fromAccountIds: JSON.stringify([]),
        pitchIds: JSON.stringify([])
      }
    });

    const recipientCreates = [];

    for (const [senderId, emailArray] of Object.entries(senderRecipientMap)) {
      const accountId = Number(senderId);

      if (locked.has(accountId)) {
        await prisma.campaign.delete({
          where: { id: followupCampaign.id }
        });

        return res.status(400).json({
          success: false,
          message: "One or more sender accounts are currently busy. Please wait."
        });
      }

      for (const email of emailArray) {
        const original = baseCampaign.recipients.find(r => r.email === email);

        recipientCreates.push({
          campaignId: followupCampaign.id,
          email,
          status: "pending",
          accountId,
          sentBodyHtml: original?.sentBodyHtml || "",
          sentSubject: original?.sentSubject || "",
          sentFromEmail: original?.sentFromEmail || ""
        });
      }
    }

    await prisma.campaignRecipient.createMany({
      data: recipientCreates
    });

    // 🔥 INVALIDATE CACHE
    invalidateDashboardCache(req.user.id);

    return res.json({
      success: true,
      data: followupCampaign
    });

  } catch (err) {
    console.error("Followup campaign error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

export const getAllCampaigns = async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { recipients: true }
    });

    return res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error("Get campaigns error:", err);
    res.status(500).json({ success: false });
  }
};

export const getDashboardCampaigns = async (req, res) => {
  try {
    const { range = "today", date } = req.query;

    // 🔥 REDUCED CACHE TIME - 30 seconds instead of 60
    // This ensures more real-time updates
    const cacheKey = date
      ? `dashboard:${req.user.id}:${date}`
      : `dashboard:${req.user.id}:${range}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: getDashboardCampaigns");
      return res.json({ success: true, data: cached });
    }

    let startDate = null;
    let endDate = null;
    const now = new Date();

    if (range === "today") {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date();
    }

    if (range === "week") {
      const firstDay = new Date();
      firstDay.setDate(now.getDate() - now.getDay());
      firstDay.setHours(0, 0, 0, 0);
      startDate = firstDay;
      endDate = new Date();
    }

    if (range === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date();
    }

    if (date) {
      const d = new Date(date);
      startDate = new Date(d.setHours(0, 0, 0, 0));
      endDate = new Date(d.setHours(23, 59, 59, 999));
    }

    const where = {
      userId: req.user.id,
      ...(startDate && {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      })
    };

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { recipients: true }
    });

    // Campaign counts
    const totalCampaigns = campaigns.filter(
      c => c.sendType !== "followup"
    ).length;

    const followups = campaigns.filter(c => c.sendType === "followup");
    const totalFollowups = followups.length;
    const followupEmails = followups.reduce(
      (sum, c) => sum + (c.recipients?.length || 0),
      0
    );

    // Recipient counts
    let totalRecipients = 0;
    let sentRecipients = 0;
    let pendingRecipients = 0;
    let failedRecipients = 0;

    campaigns.forEach(campaign => {
      if (campaign.sendType === "followup") return;

      campaign.recipients?.forEach(r => {
        totalRecipients++;

        if (r.status === "sent") sentRecipients++;
        else if (r.status === "pending") pendingRecipients++;
        else if (r.status === "failed") failedRecipients++;
      });
    });

    // Recent campaigns
    const recentCampaigns = [];

    for (const campaign of campaigns) {
      let fromNames = [];

      try {
        const ids = JSON.parse(campaign.fromAccountIds || "[]");

        if (ids.length) {
          const accounts = await prisma.emailAccount.findMany({
            where: { id: { in: ids } },
            select: { email: true }
          });

          fromNames = accounts.map(
            acc => acc.email.split("@")[0] + "@"
          );
        }
      } catch {}

      recentCampaigns.push({
        ...campaign,
        fromNames
      });
    }

    const responseData = {
      stats: {
        totalCampaigns,
        totalRecipients,
        sentRecipients,
        pendingRecipients,
        failedRecipients,
        totalFollowups,
        followupEmails
      },
      recentCampaigns
    };

    // 🔥 Cache for only 30 seconds for more real-time updates
    cache.set(cacheKey, responseData, 30);

    return res.json({ success: true, data: responseData });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false });
  }
};

export const getCampaignProgress = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: true
      }
    });

    if (!campaign) {
      return res.status(404).json({ success: false });
    }

    let customLimits = {};
    if (campaign.customLimits) {
      try {
        customLimits = JSON.parse(campaign.customLimits);
      } catch {}
    }

    const SAFE_LIMITS = {
      gmail: 50,
      gsuite: 80,
      rediff: 40,
      amazon: 60,
      custom: 60
    };

    function formatDuration(ms) {
      const totalMinutes = Math.ceil(ms / 60000);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }

    const grouped = {};

    for (const r of campaign.recipients) {
      if (!r.accountId) continue;

      const account = await prisma.emailAccount.findUnique({
        where: { id: r.accountId }
      });

      if (!account) continue;

      const key = account.email;

      if (!grouped[key]) {
        grouped[key] = {
          email: account.email,
          domain: account.provider,
          processing: 0,
          completed: 0,
          eta: "0m"
        };
      }

      if (r.status === "pending") grouped[key].processing++;
      if (r.status === "sent") grouped[key].completed++;
    }

    // Calculate ETA for each account
    for (const row of Object.values(grouped)) {
      const provider = (row.domain || "custom").toLowerCase();
      
      let limit = SAFE_LIMITS[provider] || SAFE_LIMITS.custom;
      
      const account = await prisma.emailAccount.findFirst({
        where: { email: row.email }
      });
      
      if (account && customLimits[account.id]) {
        limit = customLimits[account.id];
      }

      const delayPerMail = (60 * 60 * 1000) / limit;
      const remainingMs = row.processing * delayPerMail;

      row.eta = formatDuration(remainingMs);
    }

    res.json({ success: true, data: Object.values(grouped) });

  } catch (err) {
    console.error("Progress API error:", err);
    res.status(500).json({ success: false });
  }
};

export const getLockedAccounts = async (req, res) => {
  try {
    // 🔥 REDUCED CACHE TIME - 10 seconds for more real-time lock status
    const cacheKey = `locked:${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: getLockedAccounts");
      return res.json({ success: true, data: cached });
    }

    const sendingCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    cache.set(cacheKey, Array.from(locked), 10); // 10 seconds cache
    return res.json({
      success: true,
      data: Array.from(locked)
    });

  } catch (err) {
    console.error("getLockedAccounts error:", err);
    res.status(500).json({ success: false });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Delete all recipients first
    await prisma.campaignRecipient.deleteMany({
      where: { campaignId }
    });

    // Delete the campaign
    await prisma.campaign.delete({
      where: { id: campaignId }
    });

    // 🔥 INVALIDATE CACHE immediately after deletion
    invalidateDashboardCache(campaign.userId);

    return res.json({ success: true });

  } catch (err) {
    console.error("Delete campaign error:", err);
    res.status(500).json({ success: false });
  }
};