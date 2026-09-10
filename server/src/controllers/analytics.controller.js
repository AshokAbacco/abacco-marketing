import prisma from "../prismaClient.js";

export const getTodayCampaignReport = async (req, res) => {
  try {
    // ✅ Get userId from authenticated request
    const userId = req.user?.id;

    // 🔍 Enhanced debugging
    console.log("====== TODAY CAMPAIGN REPORT REQUEST ======");
    console.log("req.user:", req.user);
    console.log("User ID from token:", userId);
    console.log("Request headers:", req.headers.authorization);
    console.log("==========================================");

    if (!userId) {
      console.error("❌ CRITICAL: No user ID found in request");
      console.error("req.user object:", req.user);
      return res.status(401).json({ 
        message: "Unauthorized - No user ID found",
        error: "Authentication token is missing or invalid. Please login again.",
        debug: {
          hasUser: !!req.user,
          userId: userId
        }
      });
    }

    console.log("✅ User authenticated, userId:", userId);

    // 🔹 Today start & end
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    console.log("📅 Date range:", {
      start: start.toISOString(),
      end: end.toISOString()
    });

    // ✅ Step 1: Fetch sent recipients today
    console.log("🔍 Fetching sent recipients for userId:", userId);
    
    const sentToday = await prisma.campaignRecipient.findMany({
      where: {
        status: "sent",
        sentAt: {
          gte: start,
          lte: end,
        },
        campaign: {
          userId,
        },
      },
      select: {
        id: true,
        sentAt: true,
        accountId: true,
        sentFromEmail: true,
        email: true, // recipient email

        campaign: {
          select: {
            id: true,
            name: true,
            userId: true, // ✅ Also select userId for debugging
          },
        },
      },
    });

    console.log(`📧 Found ${sentToday.length} sent emails today for user ${userId}`);

    // ✅ Step 2: Fetch email accounts that sent today
    const accountIds = [
      ...new Set(sentToday.map(r => r.accountId).filter(Boolean)),
    ];

    console.log(`🔑 Unique account IDs used: ${accountIds.length}`, accountIds);

    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        email: true,
        provider: true,
        userId: true, // ✅ Add for debugging
      },
    });

    console.log(`📬 Found ${accounts.length} email accounts that sent today`);

    // ✅ Step 3: Fetch today's leads FROM ALL DOMAINS
    console.log("🔍 Fetching leads for userId:", userId);
    
    const leadsToday = await prisma.lead.findMany({
      where: {
        userId,
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        id: true,
        email: true,
        fromEmail: true,
        toEmail: true, // The account that received the lead
        createdAt: true,
        userId: true, // ✅ Add for debugging
      },
    });

    console.log(`🎯 Found ${leadsToday.length} leads today for user ${userId}`);

    // ✅ Step 4: Fetch ALL user's email accounts
    console.log("🔍 Fetching all email accounts for userId:", userId);
    
    const allUserAccounts = await prisma.emailAccount.findMany({
      where: { 
        userId 
      },
      select: {
        id: true,
        email: true,
        provider: true,
        userId: true, // ✅ Add for debugging
      },
    });

    console.log(`📮 Total email accounts for user: ${allUserAccounts.length}`);
    console.log("Account emails:", allUserAccounts.map(a => a.email));

    // ✅ Step 5: Create account maps
    const accountMap = {}; // By ID (for sent emails)
    const accountEmailMap = {}; // By normalized email (for leads)

    accounts.forEach(acc => {
      accountMap[acc.id] = acc;
    });

    // Map ALL user accounts by normalized email
    allUserAccounts.forEach(acc => {
      const emailLower = acc.email.toLowerCase().trim();
      accountEmailMap[emailLower] = {
        email: acc.email,
        provider: acc.provider || acc.email.split('@')[1] || 'Unknown'
      };
    });

    // console.log("🗺️ Account email map keys:", Object.keys(accountEmailMap));

    // ✅ Step 6: Count leads per receiving account (ALL DOMAINS)
    const leadsByAccount = {};

    leadsToday.forEach((lead) => {
      if (lead.toEmail) {
        const accountEmail = lead.toEmail.toLowerCase().trim();
        leadsByAccount[accountEmail] = (leadsByAccount[accountEmail] || 0) + 1;
      }
    });

    // console.log("📊 Total leads today:", leadsToday.length);
    // console.log("📊 Leads by account (ALL DOMAINS):", leadsByAccount);
    // console.log("📊 All user accounts:", Object.keys(accountEmailMap));

    // ✅ Step 7: Build analytics groups for SENT emails
    const byEmailAccount = {};
    const byDomain = {};
    const byCampaign = {};
    const detailedRows = {};

    sentToday.forEach(item => {
      const acc = accountMap[item.accountId];

      const email = acc?.email || item.sentFromEmail || "Unknown";
      const emailLower = email.toLowerCase().trim();
      const domain = acc?.provider || "Unknown";
      const campaignName = item.campaign?.name || "Unknown";

      byEmailAccount[email] = (byEmailAccount[email] || 0) + 1;
      byDomain[domain] = (byDomain[domain] || 0) + 1;
      byCampaign[campaignName] = (byCampaign[campaignName] || 0) + 1;

      // Build detailed rows for the table
      if (!detailedRows[email]) {
        detailedRows[email] = {
          email,
          domain,
          sent: 0,
          leads: leadsByAccount[emailLower] || 0
        };
      }
      detailedRows[email].sent++;
    });

    // ✅ Step 8: Add ALL accounts that have leads (even if they didn't send today)
    Object.keys(leadsByAccount).forEach(emailLower => {
      const accountInfo = accountEmailMap[emailLower];
      
      if (accountInfo) {
        // If this account is not already in detailedRows, add it
        if (!detailedRows[accountInfo.email]) {
          detailedRows[accountInfo.email] = {
            email: accountInfo.email,
            domain: accountInfo.provider,
            sent: 0,
            leads: leadsByAccount[emailLower] || 0
          };
        }
      } else {
        // Account not found in user's accounts - log warning
        console.warn(`⚠️ Lead received by unknown account: ${emailLower}`);
      }
    });

    // ✅ Step 9: Convert detailedRows to array and sort by activity
    const rows = Object.values(detailedRows).sort((a, b) => {
      // Sort by total activity (sent + leads), most active first
      return (b.sent + b.leads) - (a.sent + a.leads);
    });


    const response = {
      date: start.toISOString().split("T")[0],
      totalSent: sentToday.length,
      emailAccountsUsed: rows.filter(r => r.sent > 0).length,
      totalLeads: leadsToday.length,
      byEmailAccount,
      byDomain,
      byCampaign,
      leadsByAccount,
      rows, // Array of { email, domain, sent, leads } from ALL domains
    };

    console.log("✅ Sending response:", {
      totalSent: response.totalSent,
      emailAccountsUsed: response.emailAccountsUsed,
      totalLeads: response.totalLeads,
      rowsCount: response.rows.length
    });

    return res.json(response);

  } catch (err) {
    console.error("❌ Today Analytics Error:", err);
    console.error("Error stack:", err.stack);
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    
    return res.status(500).json({
      message: "Failed to load today's campaign report",
      error: err.message,
      errorType: err.name,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};