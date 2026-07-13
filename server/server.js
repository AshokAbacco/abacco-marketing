// server/server.js
import express from "express";
import cors from "cors";
import prisma from "./src/prismaClient.js";
import { runSync } from "./src/services/imap.service.js";

// Routes
import accountRoutes from "./src/routes/inbox/accounts.js";
import inboxRoutes from "./src/routes/inbox/inbox.js";
import customStatusRoutes from "./src/routes/inbox/customStatusRoutes.js";
import userRoutes from "./src/routes/user.js";
import smtpMailerRoutes from "./src/routes/inbox/smtpMailerRoutes.js";
import campaignsRoutes from "./src/routes/campaigns.routes.js";
import pitchRoutes from "./src/routes/pitch.routes.js";
import leadsRoutes from "./src/routes/leads.routes.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import accountGroupsRoutes from "./src/routes/inbox/accountGroups.js";

import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign, MAX_TRANSIENT_RETRIES } from "./src/services/campaignMailer.service.js";
import { startFollowupCleanupJob } from "./src/controllers/campaigns.controller.js";

const app = express();

// --------------------
// Middlewares
// --------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://abaccomarketing.onrender.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

// --------------------
// Routes
// --------------------
app.use("/api/accounts", accountRoutes);
app.use("/api/inbox", inboxRoutes);
app.use("/api/customStatus", customStatusRoutes);
app.use("/api/smtp", smtpMailerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pitches", pitchRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/account-groups", accountGroupsRoutes);

// --------------------
// Health check
// --------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------------------------------------
// 🔧 WORKER LOGIC
// --------------------------------------------------

/**
 * Recover emails stuck in "processing" for more than 30 seconds.
 *
 * • Up to 2 retries → reset to "pending" so they get picked up again
 * • After 2 retries  → mark as "failed" permanently
 *
 * Note: sendBulkCampaign uses an in-memory Set lock, so recovered "pending"
 * emails will only be re-sent if the campaign worker is still running.
 * If the server restarted, resumeSendingCampaignsSafe will restart the worker.
 */
async function recoverStuckEmails() {
  try {
    // Each send attempt now gets up to ~20s, retried up to 3x with backoff
    // inside campaignMailer.service.js (worst case ~75-80s per recipient)
    // before the row's status is updated. This threshold must stay safely
    // above that, or this job can race an in-flight retry, reset the row to
    // "pending" while it's still being processed, and let it get picked up
    // and sent a second time. 3 minutes gives a comfortable margin.
    const STUCK_THRESHOLD_MS = 3 * 60 * 1000;

    // Reset emails stuck in processing (under retry limit) — this only
    // fires for rows whose worker genuinely died (e.g. server restart),
    // not ones actively being retried within the normal flow above.
    const recovered = await prisma.campaignRecipient.updateMany({
      where: {
        status:    "processing",
        updatedAt: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) },
        retryCount: { lt: MAX_TRANSIENT_RETRIES },
      },
      data: {
        status:     "pending",
        retryCount: { increment: 1 },
        error:      "Recovered from stuck processing",
        updatedAt:  new Date(),
      },
    });

    // Permanently fail emails that exceeded retry limit
    const failed = await prisma.campaignRecipient.updateMany({
      where: {
        status:     "processing",
        updatedAt:  { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) },
        retryCount: { gte: MAX_TRANSIENT_RETRIES },
      },
      data: {
        status:    "failed",
        error:     `Max retries (${MAX_TRANSIENT_RETRIES}) exceeded after being stuck`,
        updatedAt: new Date(),
      },
    });

    if (recovered.count > 0) {
      console.log(`♻️ Recovered ${recovered.count} stuck emails → pending`);
    }
    if (failed.count > 0) {
      console.log(`❌ Marked ${failed.count} emails as failed (max ${MAX_TRANSIENT_RETRIES} retries)`);
    }

  } catch (err) {
    console.error("❌ Error in recoverStuckEmails:", err.message);
  }
}

// --------------------------------------------------

/**
 * Resume any campaigns that are still in "sending" status.
 *
 * FIX: sendBulkCampaign now has a global in-memory lock (activeCampaigns Set).
 * This means calling it for an already-running campaign is a safe no-op —
 * the lock check at the top of sendBulkCampaign will immediately return.
 *
 * So this function can safely be called on a timer without risk of spawning
 * duplicate workers or double-sending emails.
 */
async function resumeSendingCampaignsSafe() {
  try {
    const campaigns = await prisma.campaign.findMany({
      where:  { status: "sending" },
      select: { id: true },
    });

    if (campaigns.length > 0) {
      console.log(`🔄 Checking ${campaigns.length} campaigns in "sending" state`);
    }

    for (const campaign of campaigns) {
      // Only resume if there are actually emails left to send
      const remaining = await prisma.campaignRecipient.count({
        where: {
          campaignId: campaign.id,
          status:     { in: ["pending", "processing"] },
        },
      });

      if (remaining === 0) {
        console.log(`ℹ️ Campaign ${campaign.id} has no remaining emails — skipping resume`);
        continue;
      }

      console.log(`▶️ Resuming campaign ${campaign.id} (${remaining} emails remaining)`);

      // Safe to call even if already running — the lock inside sendBulkCampaign
      // will detect the duplicate and return immediately
      sendBulkCampaign(campaign.id).catch((err) => {
        console.error(`❌ Resume error for campaign ${campaign.id}:`, err.message);
      });
    }

  } catch (err) {
    console.error("❌ Error in resumeSendingCampaignsSafe:", err.message);
  }
}

// --------------------------------------------------
// 🚀 START WORKER
// --------------------------------------------------

async function startWorker() {
  console.log("🚀 Worker started...");

  // Wait for DB connections to stabilise on boot (important on Render/Railway cold starts)
  await new Promise((r) => setTimeout(r, 8000));

  console.log("⚙️ Running initial recovery and resume...");
  await recoverStuckEmails();
  await resumeSendingCampaignsSafe();

  // Recover stuck emails every 60 seconds
  setInterval(recoverStuckEmails, 60_000);

  // Resume any in-progress campaigns every 2 minutes
  // (safe: sendBulkCampaign's global lock prevents duplicate workers)
  setInterval(resumeSendingCampaignsSafe, 120_000);

  // IMAP sync every 2 minutes
  setInterval(() => {
    runSync(prisma).catch((err) =>
      console.error("📩 IMAP sync error:", err.message)
    );
  }, 120_000);
}

// --------------------------------------------------
// 🚀 START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`✅ API server running on port ${PORT}`);

  startCampaignScheduler();
  startFollowupCleanupJob();
  startWorker();
});