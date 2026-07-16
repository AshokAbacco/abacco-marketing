// server/src/services/accountDeletionWorker.js
//
// Soft-delete + background permanent-delete for EmailAccount.
//
// Flow:
//   1. DELETE /api/accounts/:id marks the row (deleted=true, deleteStatus="DELETING"),
//      computes an ETA, and returns immediately (<1s). It does NOT delete anything itself.
//   2. This module does the actual, slow, permanent deletion in the background,
//      in batches, updating progress on the same EmailAccount row after every batch.
//   3. Once every child row is gone, the EmailAccount row itself is deleted —
//      that's what frees up the email address to be re-added.
//
// Mirrors the existing worker patterns in this codebase (sendBulkCampaign's
// in-memory `activeCampaigns` lock + server.js's resumeSendingCampaignsSafe):
// no queue library, just an in-memory Set lock + a resume-on-boot sweep, since
// that's the architecture already used for campaign sending.

const BATCH_SIZE = 1000;

// Used only to produce a friendly ETA — not a hard guarantee.
const DELETE_SPEED_PER_MIN = 1200;

// In-memory lock: prevents two overlapping runs for the same account
// (e.g. a resume sweep firing while a fresh delete is already running).
const activeDeletions = new Set();

function computeEta(remainingEmails) {
  const estimatedSecondsRemaining = Math.max(
    Math.ceil((remainingEmails / DELETE_SPEED_PER_MIN) * 60),
    0
  );
  return {
    estimatedSecondsRemaining,
    estimatedDeleteAt: new Date(Date.now() + estimatedSecondsRemaining * 1000),
  };
}

async function updateProgress(prisma, accountId, deletedEmails, totalEmails, status) {
  const remaining = Math.max(totalEmails - deletedEmails, 0);
  const deleteProgress =
    totalEmails > 0 ? Math.min(100, Math.round((deletedEmails / totalEmails) * 100)) : 100;

  try {
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        deletedEmails,
        deleteProgress,
        deleteStatus: status,
        ...computeEta(remaining),
      },
    });
  } catch (e) {
    // Row may have already been removed by a concurrent/duplicate run — not fatal.
    if (e.code !== "P2025") {
      console.warn(`⚠️ [account ${accountId}] progress update failed:`, e.message);
    }
  }
}

/**
 * Does the actual permanent deletion for one account. Runs to completion
 * (or failure) without the caller awaiting it — this is what lets the
 * DELETE route respond in under a second.
 */
async function deleteAccountData(prisma, accountId) {
  if (activeDeletions.has(accountId)) return; // already running for this account
  activeDeletions.add(accountId);

  try {
    const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });

    // Nothing to do if the row is gone or was never marked for deletion
    // (e.g. resume sweep raced with the worker finishing normally).
    if (!account || !account.deleted) return;

    let totalEmails = account.totalEmails;
    if (totalEmails == null) {
      totalEmails = await prisma.emailMessage.count({ where: { emailAccountId: accountId } });
    }
    let deletedEmails = account.deletedEmails || 0;

    console.log(`🗑️ [account ${accountId}] background delete started — ${totalEmails} emails, resuming from ${deletedEmails}`);

    /* ==========================================================
       1. DELETE EMAIL MESSAGES IN BATCHES
       (Attachment.emailMessageId has onDelete: Cascade, so each
        batch's attachments go with it — no separate query needed)
       ========================================================== */
    while (true) {
      const batch = await prisma.emailMessage.findMany({
        where: { emailAccountId: accountId },
        select: { id: true },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) break;

      const ids = batch.map((m) => m.id);
      await prisma.emailMessage.deleteMany({ where: { id: { in: ids } } });

      deletedEmails = Math.min(deletedEmails + ids.length, totalEmails);
      await updateProgress(prisma, accountId, deletedEmails, totalEmails, "DELETING");

      console.log(`🗑️ [account ${accountId}] ${deletedEmails}/${totalEmails} emails deleted`);
    }

    /* ==========================================================
       2. DELETE CONVERSATIONS
       (indexed on emailAccountId — a direct equality filter, not
        an "in" list, so no chunking needed here. ConversationTag
        cascades from Conversation.)
       ========================================================== */
    await prisma.conversation.deleteMany({ where: { emailAccountId: accountId } });

    /* ==========================================================
       3. DELETE THE ACCOUNT ITSELF
       (EmailFolder / SyncState / ScheduledMessage all cascade from
        EmailAccount per the existing schema, per the comment in
        the old accounts.js DELETE route.)
       ========================================================== */
    await prisma.emailAccount
      .delete({ where: { id: accountId } })
      .catch((e) => {
        if (e.code !== "P2025") throw e; // already gone — fine
      });

    console.log(`✅ [account ${accountId}] permanently deleted (${deletedEmails} emails)`);
  } catch (err) {
    console.error(`❌ [account ${accountId}] background deletion failed:`, err.message);
    await prisma.emailAccount
      .update({ where: { id: accountId }, data: { deleteStatus: "FAILED" } })
      .catch(() => {});
  } finally {
    activeDeletions.delete(accountId);
  }
}

/**
 * Fire-and-forget kickoff. Callers (the DELETE route, and the resume sweep
 * below) must NOT await this — that's what keeps the DELETE API fast.
 */
export function startAccountDeletion(prisma, accountId) {
  deleteAccountData(prisma, accountId).catch((e) =>
    console.error(`❌ Unhandled error deleting account ${accountId}:`, e.message)
  );
}

/**
 * Resume any deletions that were interrupted by a server restart (rows left
 * with deleted=true and status DELETING or FAILED). Safe to call repeatedly —
 * the activeDeletions lock makes a re-entrant call for a running account a
 * no-op, same pattern as resumeSendingCampaignsSafe in server.js.
 */
export async function resumeAccountDeletions(prisma) {
  try {
    const stuck = await prisma.emailAccount.findMany({
      where: { deleted: true, deleteStatus: { in: ["DELETING", "FAILED"] } },
      select: { id: true, email: true },
    });

    if (stuck.length > 0) {
      console.log(`🔄 Resuming ${stuck.length} interrupted account deletion(s)`);
    }

    for (const acc of stuck) {
      startAccountDeletion(prisma, acc.id);
    }
  } catch (err) {
    console.error("❌ Error in resumeAccountDeletions:", err.message);
  }
}