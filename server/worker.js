// server/worker.js — BACKGROUND WORKER PROCESS
//
// Owns ALL background work: campaign sending, the scheduler, IMAP sync,
// stuck-row recovery, follow-up cleanup, account deletions and email
// retention. The API process (server.js) never sends email.
//
//   npm run start:worker        (Render: Background Worker)
//
// Run ONE instance. A second instance would not double-send (rows are
// claimed with FOR UPDATE SKIP LOCKED) and hourly pacing is shared through
// EmailAccount.nextSendAt, but it doubles database load and IMAP
// connections for no benefit. The heartbeat logs a warning if it sees one.

import "dotenv/config";
import os from "os";

// Must be set before prismaClient.js is imported (it sizes the pool by role).
process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "worker";

const { default: prisma, isDbUnavailableError } =
  await import("./src/prismaClient.js");
const { initObservability, captureError, flushObservability } =
  await import("./src/observability.js");
await initObservability("worker");
const { runSync } = await import("./src/services/imap.service.js");
const { resumeAccountDeletions } =
  await import("./src/services/accountDeletionWorker.js");
const { startCampaignScheduler } =
  await import("./src/utils/campaignScheduler.js");
const {
  sendBulkCampaign,
  isCampaignActive,
  getActiveCampaignIds,
  flushDailyLog,
  MAX_TRANSIENT_RETRIES,
  ensurePacingColumn,
  renewSendLease,
  releaseSendLease,
  isSendLeader,
} = await import("./src/services/campaignMailer.service.js");
const { runFollowupCleanup } =
  await import("./src/controllers/campaigns.controller.js");
const { purgeExpiredEmails } =
  await import("./src/services/emailRetention.service.js");
const { EMAIL_RETENTION_DAYS } = await import("./src/config/emailRetention.js");
const { resumeExpiredPauses } =
  await import("./src/services/inboundProcessor.service.js");
const { runTaskReminders, purgeOldNotifications } =
  await import("./src/controllers/crm/tasks.controller.js");
const { runSequences } = await import("./src/services/automation.service.js");
const { flushAccountSends, purgeOldDailySends } =
  await import("./src/services/sendingLimits.service.js");

/* ══════════════════════════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════════════════════════ */

const ms = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// How quickly a campaign started from the UI begins sending.
const RESUME_TICK_MS = ms("WORKER_RESUME_TICK_MS", 10_000);
const RECOVERY_TICK_MS = ms("WORKER_RECOVERY_TICK_MS", 120_000);
const IMAP_TICK_MS = ms("IMAP_SYNC_INTERVAL_MS", 120_000);
const DELETION_TICK_MS = ms("WORKER_DELETION_TICK_MS", 120_000);
const RETENTION_TICK_MS = ms("RETENTION_INTERVAL_MS", 10 * 60_000);
const CLEANUP_TICK_MS = ms("FOLLOWUP_CLEANUP_INTERVAL_MS", 60 * 60_000);

// Rows "processing" longer than this are assumed orphaned (worker died).
// The sender heartbeats each row right before sending it and never holds a
// claimed row longer than ~1 minute plus one SMTP attempt, so 3 minutes is
// a safe margin.
const STUCK_THRESHOLD_MS = ms("STUCK_THRESHOLD_MS", 3 * 60_000);

// Optional: clear stored HTML bodies of FOLLOW-UP recipients this many days
// after sending. Follow-ups always quote the ROOT campaign's body, so these
// are only used by the "view email" modal. 0 = keep forever (default).
const FOLLOWUP_BODY_RETENTION_DAYS =
  Number(process.env.FOLLOWUP_BODY_RETENTION_DAYS) || 0;

/* ══════════════════════════════════════════════════════════════════════════
   CIRCUIT BREAKER + SINGLE-FLIGHT JOBS

   • A job never overlaps itself: if the previous run is still going when
     its timer fires, that tick is skipped (setInterval + async used to
     stack runs on a slow database, multiplying the load).
   • After a database outage, all jobs pause with exponential backoff
     instead of hammering a server that is in recovery mode.
══════════════════════════════════════════════════════════════════════════ */

let consecutiveFailures = 0;
let pausedUntil = 0;
let shuttingDown = false;

const circuitOpen = () => Date.now() < pausedUntil;

function noteSuccess() {
  if (consecutiveFailures > 0) {
    console.log("✅ Database recovered — resuming background jobs");
  }
  consecutiveFailures = 0;
  pausedUntil = 0;
}

// "Timed out fetching a new connection" means the pool was BUSY, not that
// the database is down. Pausing every background job for it (as before)
// also stopped the IMAP reply sync, so replies/notifications stopped
// arriving. Now the job just tries again on its next tick.
const isPoolBusy = (err) =>
  err?.code === "P2024" ||
  String(err?.message || "").includes("Timed out fetching a new connection");

function noteFailure(label, err) {
  if (isPoolBusy(err)) {
    console.warn(`⏳ ${label}: database pool busy — will retry next tick`);
    return;
  }
  if (!isDbUnavailableError(err)) {
    console.error(`❌ ${label}:`, err?.message || err);
    captureError(err, { tags: { job: label } });
    return;
  }
  consecutiveFailures++;
  const backoff = Math.min(30_000 * 2 ** (consecutiveFailures - 1), 300_000);
  pausedUntil = Date.now() + backoff;

  if (consecutiveFailures === 1) {
    console.error(
      `🔌 Database unreachable (${label}). Pausing background jobs for ${backoff / 1000}s.`,
    );
  } else if (consecutiveFailures % 5 === 0) {
    console.error(
      `🔌 Still unreachable after ${consecutiveFailures} attempts. Next retry in ${backoff / 1000}s.`,
    );
  }
}

const running = new Set();

function job(label, fn) {
  return async () => {
    if (shuttingDown || circuitOpen() || running.has(label)) return;
    running.add(label);
    try {
      await fn();
      noteSuccess();
    } catch (err) {
      noteFailure(label, err);
    } finally {
      running.delete(label);
    }
  };
}

const timers = [];
function every(intervalMs, label, fn) {
  const run = job(label, fn);
  const t = setInterval(run, intervalMs);
  timers.push(t);
  return run;
}

/* ══════════════════════════════════════════════════════════════════════════
   JOBS
══════════════════════════════════════════════════════════════════════════ */

/** Return orphaned "processing" rows to "pending" (or fail them). */
async function recoverStuckEmails() {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const recovered = await prisma.campaignRecipient.updateMany({
    where: {
      status: "processing",
      updatedAt: { lt: cutoff },
      retryCount: { lt: MAX_TRANSIENT_RETRIES },
    },
    data: {
      status: "pending",
      retryCount: { increment: 1 },
      error: "Recovered from stuck processing (Worker or Network timeout)",
      updatedAt: new Date(),
    },
  });

  const failed = await prisma.campaignRecipient.updateMany({
    where: {
      status: "processing",
      updatedAt: { lt: cutoff },
      retryCount: { gte: MAX_TRANSIENT_RETRIES },
    },
    data: {
      status: "failed",
      error: `Max retries (${MAX_TRANSIENT_RETRIES}) exceeded after persistent timeout`,
      updatedAt: new Date(),
    },
  });

  if (recovered.count > 0)
    console.log(`♻️ Recovered ${recovered.count} stuck emails → pending`);
  if (failed.count > 0)
    console.log(`❌ Marked ${failed.count} stuck emails as failed`);
}

/** Check sending campaigns and restart processors if work remains. */
async function resumeSendingCampaigns() {
  // Only the worker holding the sender lease sends (see renewSendLease).
  if (!isSendLeader()) return;
  const campaigns = await prisma.campaign.findMany({
    where: { status: "sending" },
    select: { id: true },
  });

  for (const { id } of campaigns) {
    if (isCampaignActive(id)) continue;

    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId: id, status: { in: ["pending", "processing"] } },
    });

    if (remaining === 0) {
      // Nothing left — trigger the function to resolve it to "completed" cleanly.
      sendBulkCampaign(id).catch((err) =>
        console.error(`❌ Finalize error for campaign ${id}:`, err.message),
      );
      continue;
    }

    sendBulkCampaign(id).catch((err) =>
      console.error(`❌ Send loop error for campaign ${id}:`, err.message),
    );
  }
}

/**
 * Heartbeat: lets the CRM tell "worker is down, nothing can send" apart
 * from a campaign that is simply waiting (daily cap, cooldown, …).
 */
const WORKER_HEARTBEAT_KEY = "worker.heartbeat";
const WORKER_INSTANCE = `${os.hostname()}:${process.pid}:${Math.random()
  .toString(36)
  .slice(2, 8)}`;
let lastDuplicateWarnAt = 0;
async function writeHeartbeat() {
  // Two workers on one database overwrite each other's heartbeat: if the
  // last one isn't ours and is fresh, another worker is running. Sending is
  // still paced correctly (EmailAccount.nextSendAt), but say so loudly.
  const prev = await prisma.crmSetting
    .findUnique({ where: { key: WORKER_HEARTBEAT_KEY } })
    .catch(() => null);
  const pv = prev?.value || {};
  const fresh = pv.at && Date.now() - new Date(pv.at).getTime() < 90_000;
  const otherWorker =
    fresh && pv.instance && pv.instance !== WORKER_INSTANCE
      ? pv.instance
      : null;
  if (otherWorker && Date.now() - lastDuplicateWarnAt > 10 * 60_000) {
    lastDuplicateWarnAt = Date.now();
    console.warn(
      `🚨 ANOTHER WORKER IS RUNNING on this database (${otherWorker}); this one is ` +
        `${WORKER_INSTANCE}. Run only ONE worker — stop the other (e.g. a local ` +
        `npm run start:worker pointed at production).`,
    );
  }
  const value = {
    at: new Date().toISOString(),
    pid: process.pid,
    instance: WORKER_INSTANCE,
    host: os.hostname(),
    otherWorker,
    activeCampaigns: getActiveCampaignIds(),
  };
  await prisma.crmSetting.upsert({
    where: { key: WORKER_HEARTBEAT_KEY },
    update: { value },
    create: { key: WORKER_HEARTBEAT_KEY, value },
  });
}

/**
 * No mailbox is ever paused, and no wait is longer than an hour. Old data
 * from the previous engine (24 h quota pauses, never-ending "Login failed"
 * pauses) is cleared every time the worker starts.
 */
async function clearOldPauses() {
  // Cooldowns are 2 minutes now; anything longer is left over from old code.
  const inAnHour = new Date(Date.now() + 5 * 60_000);
  const [paused, cooldowns] = await Promise.all([
    prisma.emailAccount.updateMany({
      where: { sendingPausedAt: { not: null } },
      data: {
        sendingPausedAt: null,
        sendingPausedReason: null,
        sendingPausedUntil: null,
      },
    }),
    prisma.emailAccount.updateMany({
      where: { sendingCooldownUntil: { gt: inAnHour } },
      data: { sendingCooldownUntil: null, sendingCooldownReason: null },
    }),
    // NOTE: campaigns paused by a USER ("stopped") are left alone — only
    // the user's Resend button restarts them.
  ]);
  if (paused.count || cooldowns.count) {
    console.log(
      `🧹 Cleared ${paused.count} mailbox pause(s), ${cooldowns.count} long cooldown(s)`,
    );
  }
}

/** Optional storage cleanup — see FOLLOWUP_BODY_RETENTION_DAYS. */
async function trimFollowupBodies() {
  if (FOLLOWUP_BODY_RETENTION_DAYS <= 0) return;
  const cutoff = new Date(
    Date.now() - FOLLOWUP_BODY_RETENTION_DAYS * 86_400_000,
  );

  // Small batches so this never holds long locks.
  for (let i = 0; i < 20 && !shuttingDown; i++) {
    const n = await prisma.$executeRaw`
      UPDATE "CampaignRecipient" SET "sentBodyHtml" = NULL
      WHERE "id" IN (
        SELECT r."id"
        FROM "CampaignRecipient" r
        JOIN "Campaign" c ON c."id" = r."campaignId"
        WHERE c."sendType" = 'followup'
          AND r."status" = 'sent'
          AND r."sentAt" < ${cutoff}
          AND r."sentBodyHtml" IS NOT NULL
        LIMIT 1000
      )
    `;
    if (n < 1000) break;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   START
══════════════════════════════════════════════════════════════════════════ */

async function waitForDatabase() {
  for (let attempt = 1; !shuttingDown; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      const wait = Math.min(5000 * attempt, 60_000);
      console.error(
        `⏳ Database not ready (${err.message.split("\n").pop()}). Retrying in ${wait / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function startWorker() {
  console.log("🚀 Worker process starting...");
  await waitForDatabase();
  if (shuttingDown) return;

  // Per-mailbox pacing column (self-healing if the migration wasn't run),
  // then take the sender lease before anything can send.
  await ensurePacingColumn();
  await renewSendLease();
  every(ms("SEND_LEASE_RENEW_MS", 15_000), "sendLease", renewSendLease);

  console.log("⚙️ Initial recovery and resume...");
  await job("clearOldPauses", clearOldPauses)();
  await job("recoverStuckEmails", recoverStuckEmails)();
  await job("resumeSendingCampaigns", resumeSendingCampaigns)();
  await job("resumeAccountDeletions", () => resumeAccountDeletions(prisma))();

  console.log(
    `🧭 Ticks: resume ${RESUME_TICK_MS / 1000}s · recovery ${RECOVERY_TICK_MS / 1000}s · ` +
      `imap ${IMAP_TICK_MS / 1000}s · retention ${RETENTION_TICK_MS / 60_000}min (${EMAIL_RETENTION_DAYS}d)`,
  );

  every(RESUME_TICK_MS, "resumeSendingCampaigns", resumeSendingCampaigns);
  every(ms("WORKER_HEARTBEAT_MS", 30_000), "heartbeat", writeHeartbeat)();
  every(RECOVERY_TICK_MS, "recoverStuckEmails", recoverStuckEmails);
  every(DELETION_TICK_MS, "resumeAccountDeletions", () =>
    resumeAccountDeletions(prisma),
  );
  every(IMAP_TICK_MS, "imapSync", () => runSync(prisma));
  every(CLEANUP_TICK_MS, "followupCleanup", runFollowupCleanup);
  every(CLEANUP_TICK_MS, "trimFollowupBodies", trimFollowupBodies);
  every(
    ms("ACCOUNT_RESUME_TICK_MS", 5 * 60_000),
    "resumeExpiredPauses",
    resumeExpiredPauses,
  );
  every(ms("TASK_REMINDER_TICK_MS", 60_000), "taskReminders", () =>
    runTaskReminders(),
  );
  every(ms("SEQUENCE_TICK_MS", 10 * 60_000), "followupSequences", () =>
    runSequences(),
  );
  every(ms("DAILY_SEND_PURGE_TICK_MS", 24 * 3_600_000), "purgeDailySends", () =>
    purgeOldDailySends(),
  );
  every(
    ms("NOTIFICATION_PURGE_TICK_MS", 6 * 3_600_000),
    "purgeNotifications",
    () => purgeOldNotifications(),
  );

  // Not awaited: a large first backlog shouldn't delay the other jobs.
  const retention = every(RETENTION_TICK_MS, "purgeExpiredEmails", () =>
    purgeExpiredEmails(prisma),
  );
  retention();

  startCampaignScheduler({ isPaused: () => shuttingDown || circuitOpen() });
}

startWorker().catch((err) => {
  console.error("💥 Worker failed to start:", err);
  process.exit(1);
});

/* ── Graceful shutdown ─────────────────────────────────────────────────── */
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down worker...`);

  timers.forEach(clearInterval);
  await releaseSendLease();

  // Hard stop if something hangs.
  setTimeout(() => process.exit(exitCode), 15_000).unref();

  try {
    await flushDailyLog();
  } catch (err) {
    console.error("⚠️ Could not flush daily send counts:", err.message);
  }
  try {
    await flushAccountSends();
  } catch (err) {
    console.error("⚠️ Could not flush per-mailbox send counts:", err.message);
  }
  await flushObservability();
  try {
    await prisma.$disconnect();
  } catch {
    /* already closed */
  }

  // Rows still "processing" are returned to "pending" by the recovery
  // sweep of the next worker, so nothing is lost.
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in worker:", err);
  captureError(err, { tags: { kind: "unhandledRejection" } });
});

process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception in worker:", err);
  captureError(err, { tags: { kind: "uncaughtException" } });
  // Exit non-zero so the platform restarts the worker.
  shutdown("uncaughtException", 1);
});