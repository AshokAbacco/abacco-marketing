// server/server.js — API + BACKGROUND WORKER, single process
//
// ⚠ MERGED ON PURPOSE: the codebase was previously split into server.js
// (API) + worker.js (campaign sending, IMAP sync, recovery sweeps,
// scheduler) so they wouldn't compete for the same Prisma connection pool.
// That split needs TWO separate Render services (a Web Service + a
// Background Worker). Since only one Web Service is available right now,
// everything below runs in this one process again.
//
// Tradeoff: under load, campaign-sending and API requests go back to
// competing for Prisma connections, which is what caused the original
// slow/hanging campaign pages. If you later add a Background Worker
// service on Render, move the WORKER LOGIC section back into worker.js
// and delete it from here.
//
// Run exactly ONE instance of this service. The campaign lock in
// campaignMailer.service.js (activeCampaigns) is an in-memory Set — two
// instances would both pick up the same campaign and double-send.

import "dotenv/config";
import express from "express";
import cors from "cors";

import prisma from "./src/prismaClient.js";
import { runSync } from "./src/services/imap.service.js";
import { resumeAccountDeletions } from "./src/routes/inbox/accounts.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign, MAX_TRANSIENT_RETRIES } from "./src/services/campaignMailer.service.js";
import { startFollowupCleanupJob } from "./src/controllers/campaigns.controller.js";

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
import dashboardRoutes from "./src/routes/dashboard.routes.js";
import accountGroupsRoutes from "./src/routes/inbox/accountGroups.js";

/* ══════════════════════════════════════════════════════════════════════════
   EXPRESS APP
══════════════════════════════════════════════════════════════════════════ */

const app = express();

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
app.use("/api/dashboard", dashboardRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", role: "api+worker" });
});

// Error handler — must stay after all routes.
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", req.method, req.originalUrl, err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Server error" });
});

/* ══════════════════════════════════════════════════════════════════════════
   WORKER LOGIC — moved in from worker.js
══════════════════════════════════════════════════════════════════════════ */

const DB_DOWN_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

let consecutiveFailures = 0;
let pausedUntil = 0;

function isConnectionError(err) {
  if (!err) return false;
  if (DB_DOWN_CODES.has(err.code)) return true;
  const msg = String(err.message || "");
  return (
    msg.includes("Server has closed the connection") ||
    msg.includes("recovery mode") ||
    msg.includes("not yet accepting connections") ||
    msg.includes("Timed out fetching a new connection")
  );
}

function circuitOpen() {
  return Date.now() < pausedUntil;
}

function noteSuccess() {
  if (consecutiveFailures > 0) {
    console.log("✅ Database recovered — resuming background jobs");
  }
  consecutiveFailures = 0;
  pausedUntil = 0;
}

function noteFailure(label, err) {
  if (!isConnectionError(err)) {
    console.error(`❌ ${label}:`, err.message);
    return;
  }

  consecutiveFailures++;
  // 30s, 60s, 120s, 240s … capped at 5 minutes
  const backoff = Math.min(30_000 * 2 ** (consecutiveFailures - 1), 300_000);
  pausedUntil = Date.now() + backoff;

  if (consecutiveFailures === 1) {
    console.error(`🔌 Database unreachable (${label}). Pausing background jobs for ${backoff / 1000}s.`);
  } else if (consecutiveFailures % 5 === 0) {
    console.error(`🔌 Still unreachable after ${consecutiveFailures} attempts. Next retry in ${backoff / 1000}s.`);
  }
}

/** Wraps a job so it skips while the circuit is open and reports failures. */
function guarded(label, fn) {
  return async (...args) => {
    if (circuitOpen()) return;
    try {
      const result = await fn(...args);
      noteSuccess();
      return result;
    } catch (err) {
      noteFailure(label, err);
    }
  };
}

/**
 * Recover emails stuck in "processing" for more than the threshold.
 * • Under retry limit → reset to "pending" so they get picked up again
 * • Over retry limit  → mark as "failed" permanently
 */
async function recoverStuckEmails() {
  try {
    const STUCK_THRESHOLD_MS = 3 * 60 * 1000;

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

/**
 * Resume any campaigns that are still in "sending" status.
 * Safe to call on a timer — sendBulkCampaign's in-memory lock (activeCampaigns
 * Set) makes calling it for an already-running campaign a no-op.
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

      sendBulkCampaign(campaign.id).catch((err) => {
        console.error(`❌ Resume error for campaign ${campaign.id}:`, err.message);
      });
    }
  } catch (err) {
    console.error("❌ Error in resumeSendingCampaignsSafe:", err.message);
  }
}

const TICK_MS = 120_000;

async function startBackgroundJobs() {
  console.log("🚀 Background jobs starting (same process as API)...");

  // Wait for DB connections to stabilise on boot (cold starts, and after a
  // crash-recovery restart the database may not accept connections yet).
  await new Promise((r) => setTimeout(r, 8000));

  console.log("⚙️ Running initial recovery and resume...");
  await guarded("recoverStuckEmails", recoverStuckEmails)();
  await guarded("resumeSendingCampaigns", resumeSendingCampaignsSafe)();
  await guarded("resumeAccountDeletions", () => resumeAccountDeletions(prisma))();

  setInterval(guarded("recoverStuckEmails", recoverStuckEmails), TICK_MS);
  setInterval(guarded("resumeSendingCampaigns", resumeSendingCampaignsSafe), TICK_MS);
  setInterval(guarded("resumeAccountDeletions", () => resumeAccountDeletions(prisma)), TICK_MS);
  setInterval(guarded("imapSync", () => runSync(prisma)), TICK_MS);
}

/* ══════════════════════════════════════════════════════════════════════════
   START — API server + background jobs together
══════════════════════════════════════════════════════════════════════════ */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ API server running on port ${PORT}`);
});

startCampaignScheduler();
startFollowupCleanupJob();
startBackgroundJobs();

/* ── Graceful shutdown: let in-flight sends finish writing status rows ──── */
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\n${signal} received — shutting down...`);
    try {
      await prisma.$disconnect();
    } catch { /* already closed */ }
    process.exit(0);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});