import prisma from "../prisma.js";

export const getTodayCampaignReport = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 🔹 Today start & end
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    // ✅ Step 1: Fetch sent recipients today
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
          },
        },
      },
    });

    // ✅ Step 2: Fetch email accounts that sent today
    const accountIds = [
      ...new Set(sentToday.map(r => r.accountId).filter(Boolean)),
    ];

    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        email: true,
        provider: true,
      },
    });

    // ✅ Step 3: Fetch today's leads FROM ALL DOMAINS (No filtering by domain)
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
      },
    });

    // ✅ Step 4: Fetch ALL user's email accounts (Gmail, Amazon, Rediff, G Suite, etc.)
    const allUserAccounts = await prisma.emailAccount.findMany({
      where: { 
        userId 
      },
      select: {
        id: true,
        email: true,
        provider: true,
      },
    });

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

    // ✅ Step 6: Count leads per receiving account (ALL DOMAINS)
    const leadsByAccount = {};

    leadsToday.forEach((lead) => {
      if (lead.toEmail) {
        const accountEmail = lead.toEmail.toLowerCase().trim();
        leadsByAccount[accountEmail] = (leadsByAccount[accountEmail] || 0) + 1;
      }
    });

    console.log("🔍 Total leads today:", leadsToday.length);
    console.log("🔍 Leads by account (ALL DOMAINS):", leadsByAccount);
    console.log("🔍 All user accounts:", Object.keys(accountEmailMap));

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
    // This ensures Gmail, Amazon, Rediff, G Suite, and ANY other domain appears
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

    console.log("📊 Final rows (ALL DOMAINS):", rows);

    return res.json({
      date: start.toISOString().split("T")[0],
      totalSent: sentToday.length,
      emailAccountsUsed: rows.filter(r => r.sent > 0).length,
      totalLeads: leadsToday.length,
      byEmailAccount,
      byDomain,
      byCampaign,
      leadsByAccount,
      rows, // Array of { email, domain, sent, leads } from ALL domains
    });
  } catch (err) {
    console.error("❌ Today Analytics Error:", err);
    return res.status(500).json({
      message: "Failed to load today's campaign report",
      error: err.message
    });
  }
};