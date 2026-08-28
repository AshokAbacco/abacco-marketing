import prisma from "../prismaClient.js";

let cache = null;
let lastFetch = 0;

export const getDashboard = async (req, res) => {
  try {
    console.time("dashboard");

    // ✅ 30 sec cache (BIG performance boost)
    if (Date.now() - lastFetch < 30000 && cache) {
      console.timeEnd("dashboard");
      return res.json(cache);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ✅ PARALLEL FAST QUERIES (NO heavy findMany)
    const [
      totalCampaigns,
      activeCampaigns,
      todayCampaigns,
      totalLeads,
      todayLeads,
      emailsSentToday,
      recentCampaigns,
      scheduledCampaigns,
      topCampaigns,
    ] = await Promise.all([

      // 🔢 Counts (FAST)
      prisma.campaign.count(),

      prisma.campaign.count({
        where: { status: "sending" },
      }),

      prisma.campaign.count({
        where: { createdAt: { gte: today } },
      }),

      prisma.lead.count(),

      prisma.lead.count({
        where: { createdAt: { gte: today } },
      }),

      prisma.campaignRecipient.count({
        where: {
          campaign: {
            status: "completed",
            createdAt: { gte: today },
          },
        },
      }),

      // 📊 Recent campaigns (LIMITED)
      prisma.campaign.findMany({
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          name: true,
          _count: { select: { recipients: true } },
        },
      }),

      // 📅 Scheduled campaigns
      prisma.campaign.findMany({
        where: { status: "scheduled" },
        orderBy: { scheduledTime: "asc" },
        take: 4,
        select: {
          name: true,
          scheduledTime: true,
        },
      }),

      // 🏆 Top campaigns
      prisma.campaign.findMany({
        take: 4,
        orderBy: {
          recipients: { _count: "desc" },
        },
        select: {
          name: true,
          _count: { select: { recipients: true } },
        },
      }),
    ]);

    // ✅ FORMAT DATA (lightweight only)
    const result = {
      todayCampaigns,
      totalCampaigns,
      emailsSentToday,
      activeCampaigns,
      todayLeads,
      totalLeads,

      recentCampaigns: recentCampaigns.map((c) => ({
        name: c.name || "Untitled",
        performance: Math.min(100, c._count.recipients || 0),
      })),

      scheduledCampaigns: scheduledCampaigns.map((c) => ({
        name: c.name || "Untitled",
        time: new Date(c.scheduledTime).toLocaleString(),
      })),

      topCampaigns: topCampaigns.map((c) => ({
        name: c.name || "Untitled",
        company: `${c._count.recipients} recipients`,
        score: 100,
      })),

      // keep empty or simple for now (can optimize later)
      recentActivity: [],
      upcomingFollowups: [],
    };

    // ✅ Save cache
    cache = result;
    lastFetch = Date.now();

    console.timeEnd("dashboard");

    return res.json(result);

  } catch (err) {
    console.error("Dashboard Error:", err);
    return res.status(500).json({ error: err.message });
  }
};