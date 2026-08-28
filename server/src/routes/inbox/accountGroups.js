/**
 * routes/accountGroups.js
 *
 * CRUD routes for EmailAccountGroup.
 * Mount in your main router as:
 *   app.use("/api/account-groups", accountGroupsRouter);
 */

import express from "express";
import { PrismaClient } from "@prisma/client";
import { protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();
const prisma = new PrismaClient();

/* ─────────────────────────────────────────────────────────────
   GET /api/account-groups
   Returns all groups for the logged-in user.
───────────────────────────────────────────────────────────── */
router.get("/", protect, async (req, res) => {
  try {
    const groups = await prisma.emailAccountGroup.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ success: true, data: groups });
  } catch (err) {
    console.error("GET /account-groups error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/account-groups
   Body: { name, color? }
───────────────────────────────────────────────────────────── */
router.post("/", protect, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: "Group name is required" });
    }

    const group = await prisma.emailAccountGroup.create({
      data: {
        name: name.trim(),
        color: color || "#10b981",
        userId: req.user.id,
      },
    });

    res.status(201).json({ success: true, data: group });
  } catch (err) {
    console.error("POST /account-groups error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   PATCH /api/account-groups/:id
   Body: { name?, color? }
───────────────────────────────────────────────────────────── */
router.patch("/:id", protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid group id" });
    }

    const { name, color } = req.body;

    if (name !== undefined && !name?.trim()) {
      return res.status(400).json({ success: false, error: "Group name cannot be empty" });
    }

    // Ensure ownership
    const existing = await prisma.emailAccountGroup.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Group not found" });
    }

    const updated = await prisma.emailAccountGroup.update({
      where: { id },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(color        ? { color }              : {}),
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("PATCH /account-groups/:id error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
/* ─────────────────────────────────────────────────────────────
   DELETE /api/account-groups/:id
   Deletes the group AND all accounts inside it, along with
   every related record (messages, attachments, conversations,
   tags, folders, sync states) for each account.
───────────────────────────────────────────────────────────── */
router.delete("/:id", protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid group id" });
    }

    const existing = await prisma.emailAccountGroup.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Group not found" });
    }

    // Run the whole cascade in one transaction: if any step fails,
    // everything rolls back instead of leaving partially-deleted data.
    const deletedAccountCount = await prisma.$transaction(async (tx) => {
      const accountsInGroup = await tx.emailAccount.findMany({
        where: { groupId: id },
        select: { id: true },
      });
      const accountIds = accountsInGroup.map((a) => a.id);

      if (accountIds.length > 0) {
        // ── Messages + their children ──────────────────────────────
        const messages = await tx.emailMessage.findMany({
          where: { emailAccountId: { in: accountIds } },
          select: { id: true },
        });
        const messageIds = messages.map((m) => m.id);

        if (messageIds.length > 0) {
          await tx.attachment.deleteMany({
            where: { emailMessageId: { in: messageIds } },
          });
          await tx.messageTag.deleteMany({
            where: { messageId: { in: messageIds } },
          });
        }

        await tx.emailMessage.deleteMany({
          where: { emailAccountId: { in: accountIds } },
        });

        // ── Conversations + their children ───────────────────────────
        const conversations = await tx.conversation.findMany({
          where: { emailAccountId: { in: accountIds } },
          select: { id: true },
        });
        const conversationIds = conversations.map((c) => c.id);

        if (conversationIds.length > 0) {
          await tx.conversationTag.deleteMany({
            where: { conversationId: { in: conversationIds } },
          });
          await tx.scheduledMessage.deleteMany({
            where: { conversationId: { in: conversationIds } },
          });
        }

        await tx.conversation.deleteMany({
          where: { emailAccountId: { in: accountIds } },
        });

        // ── ScheduledMessages tied directly to the account ───────────
        // (not just the ones tied to a conversation, cleaned up above)
        await tx.scheduledMessage.deleteMany({
          where: { emailAccountId: { in: accountIds } },
        });

        // ── Other per-account data ────────────────────────────────────
        await tx.emailFolder.deleteMany({
          where: { accountId: { in: accountIds } },
        });
        await tx.syncState.deleteMany({
          where: { accountId: { in: accountIds } },
        });

        // ── Accounts themselves ───────────────────────────────────────
        await tx.emailAccount.deleteMany({
          where: { id: { in: accountIds } },
        });
      }

      // ── The group ─────────────────────────────────────────────────
      await tx.emailAccountGroup.delete({ where: { id } });

      return accountIds.length;
    });

    res.json({
      success: true,
      message: `Group deleted along with ${deletedAccountCount} account(s) and all their data.`,
      deletedAccountCount,
    });
  } catch (err) {
    console.error("DELETE /account-groups/:id error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;