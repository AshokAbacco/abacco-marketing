// server/src/controllers/dashboard.controller.js
//
// ⚠ RECONCILE BEFORE APPLYING
// This is based on the version in the repo. Your deployed copy is newer —
// it populates `upcomingFollowups`, which the repo version hardcodes to [].
// Port that section across before replacing the file, or apply the three
// changes below to your current copy by hand.

import prisma from "../prismaClient.js";
import cache from "../utils/cache.js";

export const getDashboard = async (req, res) => {
  const t0 = Date.now();

  try {
    /* ── FIX 1: scope to the logged-in user ───────────────────────────────
       Every query here ran unscoped: prisma.campaign.count() counted ALL
       campaigns for ALL users, and prisma.lead.count() every lead in the
       system. So each employee saw company-wide totals, and the queries
       scanned far more rows than they needed to.

       This requires `protect` on the route — see dashboard.routes.js below. */
    const userId = req.user.id;

    /* ── FIX 2: per-user cache ────────────────────────────────────────────
       Was a single module-level `cache` variable shared by every user, so
       whoever loaded first populated everyone else's dashboard.            */
    const cacheKey = `appDashboard:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[dashboard] CACHE HIT ${Date.now() - t0}ms`);
      return res.json(cached);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const scope = { userId };

    const [
      totalCampaigns,
      activeCampaigns,
      todayCampaigns,
      totalLeads,
      todayLeads,
      emailsSentToday,
      recentCampaigns,
      scheduledCampaigns,
    ] = await Promise.all([
      prisma.campaign.count({ where: scope }),

      prisma.campaign.count({ where: { ...scope, status: "sending" } }),

      prisma.campaign.count({ where: { ...scope, createdAt: { gte: today } } }),

      prisma.lead.count({ where: scope }),

      prisma.lead.count({ where: { ...scope, createdAt: { gte: today } } }),

      // Counts rows actually sent today, rather than joining through
      // campaign.createdAt — which missed emails sent today by a campaign
      // created yesterday, and could not use an index.
      prisma.campaignRecipient.count({
        where: {
          status: "sent",
          sentAt: { gte: today },
          campaign: scope,
        },
      }),

      prisma.campaign.findMany({
        where: { ...scope, status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { id: true, name: true },
      }),

      prisma.campaign.findMany({
        where: { ...scope, status: "scheduled" },
        // NOTE: the repo version ordered and selected `scheduledTime`, which
        // does not exist on the Campaign model — the field is `scheduledAt`.
        // If your deployed schema really has `scheduledTime`, keep that name.
        orderBy: { scheduledAt: "asc" },
        take: 4,
        select: { id: true, name: true, scheduledAt: true },
      }),
    ]);

    /* ── FIX 3: the actual slowness ───────────────────────────────────────
       "Top campaigns" used:

           orderBy: { recipients: { _count: "desc" } }

       Prisma turns that into a correlated aggregate over the WHOLE
       CampaignRecipient table, grouped and sorted, before taking 4 rows.
       There is no index that can serve it, so cost grows with total
       recipients — which is exactly why it degrades as campaigns pile up.

       Instead: group recipients by campaignId (hits @@index([campaignId])),
       sort in memory, take the top 4, then fetch just those names.        */
    const tTop = Date.now();

    const userCampaignIds = await prisma.campaign.findMany({
      where: scope,
      select: { id: true },
    });

    let topCampaigns = [];

    if (userCampaignIds.length) {
      const grouped = await prisma.campaignRecipient.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: userCampaignIds.map(c => c.id) } },
        _count: { _all: true },
        orderBy: { _count: { campaignId: "desc" } },
        take: 4,
      });

      if (grouped.length) {
        const names = await prisma.campaign.findMany({
          where: { id: { in: grouped.map(g => g.campaignId) } },
          select: { id: true, name: true },
        });
        const nameMap = Object.fromEntries(names.map(n => [n.id, n.name]));

        topCampaigns = grouped.map(g => ({
          name: nameMap[g.campaignId] || "Untitled",
          company: `${g._count._all} recipients`,
          score: 100,
        }));
      }
    }

    const topMs = Date.now() - tTop;

    /* ── FIX 4: "performance" was never a percentage ───────────────────────
       It was `Math.min(100, recipientCount)` — a raw COUNT rendered as a %.
       A 482-recipient campaign showed 100%; a 30-recipient one showed 30%.
       The bar measured nothing.

       Real delivery rate = sent / total. One grouped query covers all four
       campaigns, and the counts are returned too so an empty bar is
       distinguishable from a campaign that genuinely has no recipients.   */
    const recentIds = recentCampaigns.map(c => c.id);

    const recentStats = recentIds.length
      ? await prisma.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          where: { campaignId: { in: recentIds } },
          _count: { _all: true },
        })
      : [];

    const statsByCampaign = {};
    for (const id of recentIds) statsByCampaign[id] = { total: 0, sent: 0, failed: 0 };
    for (const row of recentStats) {
      const b = statsByCampaign[row.campaignId];
      if (!b) continue;
      b.total += row._count._all;
      if (row.status === "sent") b.sent += row._count._all;
      else if (row.status === "failed") b.failed += row._count._all;
    }

    const recentPerformance = recentCampaigns.map(c => {
      const st = statsByCampaign[c.id] || { total: 0, sent: 0, failed: 0 };
      return {
        name: c.name || "Untitled",
        // Delivery rate. 0 recipients → 0%, and totalRecipients tells the
        // UI to say "no recipients" rather than imply a failed send.
        performance: st.total > 0 ? Math.round((st.sent / st.total) * 100) : 0,
        sentCount: st.sent,
        failedCount: st.failed,
        totalRecipients: st.total,
      };
    });

    const result = {
      todayCampaigns,
      totalCampaigns,
      emailsSentToday,
      activeCampaigns,
      todayLeads,
      totalLeads,

      recentCampaigns: recentPerformance,

      scheduledCampaigns: scheduledCampaigns.map(c => ({
        name: c.name || "Untitled",
        time: c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : "—",
      })),

      topCampaigns,

      recentActivity: [],
      // ⚠ Port your deployed implementation of this across.
      upcomingFollowups: [],
    };

    cache.set(cacheKey, result, 30);

    console.log(`[dashboard] ${Date.now() - t0}ms (topCampaigns ${topMs}ms)`);
    return res.json(result);

  } catch (err) {
    console.error("Dashboard Error:", err, `after ${Date.now() - t0}ms`);
    return res.status(500).json({ error: "Failed to load dashboard" });
  }
};