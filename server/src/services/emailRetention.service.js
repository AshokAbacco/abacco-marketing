// server/src/services/emailRetention.service.js
//
// Rolling 7-day retention for EmailMessage.
//
// HOW "EACH EMAIL HAS ITS OWN 7 DAYS" WORKS
//   The job runs every few minutes (see worker.js). Each run deletes only the
//   rows where createdAt < now − 7 days. An email that arrived today is not
//   touched until 7 days from today; one that arrives tomorrow waits until
//   7 days from tomorrow. Nothing is deleted "in bulk once a week".
//
// WHY BATCHES
//   Around 15 users × 30–50 accounts is roughly 750 mailboxes. The very first
//   run may have months of backlog. One giant DELETE would lock the table and
//   stall the inbox API, so rows go in batches of BATCH_SIZE with a short pause
//   in between, and each run is capped. Leftover backlog is picked up on the
//   next tick.
//
// WHAT GOES WITH EACH EMAIL (database-level ON DELETE CASCADE in schema.prisma)
//   Attachment, MessageTag.
//
// CONVERSATIONS
//   After their messages are gone, empty Conversation rows are removed too,
//   EXCEPT any that still have a ScheduledMessage (follow-up) attached.
//   ScheduledMessage cascades from Conversation, so deleting those
//   conversations would silently cancel pending follow-ups.

import {
  EMAIL_RETENTION_DAYS,
  RETENTION_EXEMPT_FOLDERS,
  retentionCutoff,
} from "../config/emailRetention.js";

const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 40; // ≤ 40k emails per run; the rest wait for the next tick
const PAUSE_BETWEEN_BATCHES_MS = 200;

let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function expiredWhere(cutoff) {
  return {
    createdAt: { lt: cutoff },
    // Explicit null branch: `folder` is nullable, and `notIn` alone would
    // skip NULL-folder rows, leaving them in the table forever.
    OR: [{ folder: null }, { folder: { notIn: RETENTION_EXEMPT_FOLDERS } }],
  };
}

async function purgeMessages(prisma, cutoff) {
  let deleted = 0;
  let reachedEnd = false;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await prisma.emailMessage.findMany({
      where: expiredWhere(cutoff),
      select: { id: true },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) {
      reachedEnd = true;
      break;
    }

    const result = await prisma.emailMessage.deleteMany({
      where: { id: { in: batch.map((m) => m.id) } },
    });
    deleted += result.count;

    if (batch.length < BATCH_SIZE) {
      reachedEnd = true;
      break;
    }
    await sleep(PAUSE_BETWEEN_BATCHES_MS);
  }

  return { deleted, reachedEnd };
}

async function purgeEmptyConversations(prisma, cutoff) {
  let deleted = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    // `none: {}` compiles to NOT EXISTS subqueries.
    // lastMessageAt guard: never remove a conversation that just had
    // activity, which avoids racing a sync/send that is about to insert
    // its first message into it.
    const batch = await prisma.conversation.findMany({
      where: {
        messages: { none: {} },
        scheduled: { none: {} },
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: cutoff } }],
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const result = await prisma.conversation.deleteMany({
      where: {
        id: { in: batch.map((c) => c.id) },
        // Re-check inside the delete in case a message landed in between.
        messages: { none: {} },
        scheduled: { none: {} },
      },
    });
    deleted += result.count;
    if (batch.length < BATCH_SIZE) break;
    await sleep(PAUSE_BETWEEN_BATCHES_MS);
  }

  return deleted;
}

/**
 * Deletes every email whose own retention window has ended.
 * Safe to call on a timer: overlapping calls are skipped.
 * Throws on DB connection errors so worker.js's circuit breaker can back off.
 */
export async function purgeExpiredEmails(prisma) {
  if (running) return { skipped: true };
  running = true;

  const started = Date.now();
  const cutoff = retentionCutoff(started);

  try {
    const { deleted, reachedEnd } = await purgeMessages(prisma, cutoff);

    // Only tidy conversations once the message backlog is cleared, so a
    // long first run spends its time on the table that actually matters.
    const conversations = reachedEnd ? await purgeEmptyConversations(prisma, cutoff) : 0;

    if (deleted > 0 || conversations > 0) {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `🧹 Retention (${EMAIL_RETENTION_DAYS}d): removed ${deleted} emails, ` +
          `${conversations} empty conversations in ${secs}s` +
          (reachedEnd ? "" : " — more backlog remains, continuing next run")
      );
    }

    return { deleted, conversations, reachedEnd };
  } finally {
    running = false;
  }
}