// server/worker.js — BACKGROUND WORKER PROCESS
//
// Split out of server.js so campaign sending, IMAP sync and the recovery
// sweeps no longer compete with API requests for the same Prisma connection
// pool. Run with: npm run start:worker
//
// ⚠ Run exactly ONE instance. The campaign lock in campaignMailer.service.js
//   (activeCampaigns) is an in-memory Set — two workers would both claim the
//   same campaign and double-send. PERFORMANCE_FIXES.md §1c has the
//   Postgres advisory-lock swap that lifts this restriction.

import "dotenv/config";
import prisma from "./src/prismaClient.js";
import { runSync } from "./src/services/imap.service.js";
import { resumeAccountDeletions } from "./src/routes/inbox/accounts.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign, MAX_TRANSIENT_RETRIES } from "./src/services/campaignMailer.service.js";
import { startFollowupCleanupJob } from "./src/controllers/campaigns.controller.js";

/* ══════════════════════════════════════════════════════════════════════════
   CIRCUIT BREAKER

   When Postgres went into recovery mode, all four interval jobs kept firing
   every 2 minutes, each grabbing connections and failing. That exhausted the
   pool and buried the real error in hundreds of log lines.

   This pauses the jobs after consecutive connection failures and backs off,
   so a database blip stays quiet instead of cascading.
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

/* ══════════════════════════════════════════════════════════════════════════
   START
══════════════════════════════════════════════════════════════════════════ */

const TICK_MS = 120_000;

async function startWorker() {
  console.log("🚀 Worker process started...");

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

startCampaignScheduler();
startFollowupCleanupJob();
startWorker();

/* ── Graceful shutdown: let in-flight sends finish writing status rows ──── */
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\n${signal} received — shutting down worker...`);
    try {
      await prisma.$disconnect();
    } catch { /* already closed */ }
    process.exit(0);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in worker:", err);
});