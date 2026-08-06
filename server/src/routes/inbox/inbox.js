// server/src/routes/inbox/inbox.js
import express from "express";
import prisma from "../../prismaClient.js";
import { protect } from "../../middlewares/authMiddleware.js";
import cache from "../../utils/cache.js";

// ─────────────────────────────────────────────
// PRISMA SCHEMA NOTE
// Add this index to your EmailMessage model for
// faster sentAt-range queries per account:
//
//   @@index([emailAccountId, sentAt])
//   @@index([emailAccountId, folder, direction, sentAt])
// ─────────────────────────────────────────────

function extractNameOrEmail(value) {
  if (!value) return "Unknown";
  const match = value.match(/(.*)<(.+)>/);
  if (match) {
    const name = match[1].replace(/['"]/g, "").trim();
    const email = match[2].trim();
    return name || email;
  }
  return value.trim();
}

const router = express.Router();

/* =========================================================
   HELPER: Resolve monthFilter → startDate
   Supported values: "current" | "last" | "three"
   Default (unknown / missing): "current"
========================================================= */
function resolveStartDate(monthFilter) {
  const now = new Date();

  if (monthFilter === "last") {
    // First day of the previous calendar month
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  if (monthFilter === "three") {
    // First day of the month that was 3 months ago
    return new Date(now.getFullYear(), now.getMonth() - 3, 1);
  }

  // Default: "current" → first day of the current month
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/* =========================================================
   HELPER: Build ALL cache keys for an account+folder
   (one per monthFilter value) so bulk-invalidation is easy.
========================================================= */
const MONTH_FILTERS = ["current", "last", "three"];

function allCacheKeys(userId, accountId, folder) {
  return MONTH_FILTERS.map(
    (mf) => `inbox:${userId}:${accountId}:${folder}:${mf}`
  );
}

function clearAllFolderCaches(userId, accountId) {
  ["inbox", "sent", "spam", "trash", "draft"].forEach((folder) => {
    allCacheKeys(userId, accountId, folder).forEach((key) => cache.del(key));
  });
}

/* =========================================================
   GET UNREAD COUNT
   GET /api/inbox/accounts/:id/unread
========================================================= */
router.get("/accounts/:id/unread", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.id);

    const count = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "received",
        isRead: false,
        folder: "inbox",
      },
    });

    res.json({ success: true, data: { inboxUnread: count } });
  } catch (err) {
    console.error("Unread error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   BULK UNREAD COUNTS (single DB query for all accounts)
   POST /api/inbox/accounts/unread-bulk
   Body: { accountIds: [1, 2, 3, ...] }

   Replaces N individual /unread requests with 1 call.
   This is the fix for the 5-10 min load time caused by
   firing one HTTP request per account on page load.
========================================================= */
router.post("/accounts/unread-bulk", protect, async (req, res) => {
  try {
    const { accountIds } = req.body;
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      return res.json({ success: true, data: {} });
    }

    // Group by emailAccountId in a single query
    const rows = await prisma.emailMessage.groupBy({
      by: ["emailAccountId"],
      where: {
        emailAccountId: { in: accountIds.map(Number) },
        direction: "received",
        isRead: false,
        folder: "inbox",
      },
      _count: { id: true },
    });

    // Build a map: { accountId: unreadCount }
    const result = {};
    accountIds.forEach((id) => { result[id] = 0; });
    rows.forEach((row) => { result[row.emailAccountId] = row._count.id; });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Bulk unread error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================
   HELPER: Build formatted messages from DB
========================================================= */
function formatMessages(messages) {
  return messages.map((m) => {
    const cleanBody = (m.body || "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&zwnj;/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      conversationId: m.conversationId,
      subject: m.subject || "(No subject)",

      displayName:
        m.direction === "sent"
          ? extractNameOrEmail(m.toEmail?.split(",")[0])
          : extractNameOrEmail(m.fromName || m.fromEmail),

      displayEmail:
        m.direction === "sent" ? m.toEmail?.split(",")[0] : m.fromEmail,

      initiatorEmail: m.fromEmail,
      lastSenderEmail: m.fromEmail,
      lastDate: m.sentAt,

      lastBody: cleanBody.slice(0, 100),

      unreadCount: m.isRead ? 0 : 1,
      messageCount: 1,
      isStarred: m.isStarred,
    };
  });
}

/* =========================================================
   GET CONVERSATIONS  (PAGINATED)
   GET /api/inbox/conversations/:accountId
       ?folder=inbox
       &monthFilter=current|last|three   ← NEW
       &limit=10                          ← NEW (default 10, max 100)
       &page=0                            ← NEW (0-indexed page number)

   monthFilter defaults to "current" when omitted.
   limit defaults to 10 so the initial load per account is cheap —
   this is the fix for the "fetches everything from every account
   at once" slowdown. The frontend calls again with page+1 (same
   limit) to implement "Load More" for that one account only.

   Cache key includes monthFilter (not limit/page) and is only
   used for the very first page (page=0, limit=10) — the common
   case on folder open. Subsequent "Load More" pages always hit
   the DB directly since they're one-off requests and caching
   every page would make invalidation (clearAllFolderCaches)
   unreliable.
========================================================= */
router.get("/conversations/:accountId", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    const { folder = "inbox", monthFilter = "current", bust } = req.query;

    // ── Pagination params ────────────────────────────────────
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const offset = page * limit;

    const safeFilter = MONTH_FILTERS.includes(monthFilter) ? monthFilter : "current";
    const cacheKey = `inbox:${req.user.id}:${accountId}:${folder}:${safeFilter}`;
    const isCacheablePage = page === 0 && limit === 10;
    const cached = !bust && isCacheablePage ? cache.get(cacheKey) : null; // skip cache when bust param present

    // ── Return cache instantly — NO sync triggered here ──────
    // Sync is triggered only by explicit Refresh button or the
    // background scheduler (imap.service.js runSync). Triggering
    // a full IMAP sync on every inbox load was the main cause of
    // 5-10 minute wait times.
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        hasMore: cached.hasMore,
        page,
        fromCache: true,
      });
    }

    // ── Cache miss: query DB directly, fast ──────────────────
    const startDate = resolveStartDate(safeFilter);

    // Build folder filter on EmailMessage for direction/folder
    let msgWhere = {
      emailAccountId: accountId,
      sentAt: { gte: startDate },
    };

    if (folder === "inbox") {
      msgWhere.folder = "inbox";
      msgWhere.direction = "received";
    } else if (folder === "sent") {
      msgWhere.folder = "sent";
      msgWhere.direction = "sent";
    } else {
      msgWhere.folder = folder; // spam, trash, draft
    }

    // Get one latest message per conversation using a subquery approach:
    // fetch just enough of the latest messages to cover the requested
    // page once deduplicated to one-row-per-conversation, instead of
    // pulling the whole mailbox. The multiplier accounts for multiple
    // messages per conversation; capped so a single request can never
    // scan more than ~2000 rows regardless of how deep "Load More" goes.
    const fetchTake = Math.min((offset + limit) * 5 + 20, 2000);

    const messages = await prisma.emailMessage.findMany({
      where: msgWhere,
      orderBy: { sentAt: "desc" },
      take: fetchTake,
      select: {
        id: true,
        conversationId: true,
        subject: true,
        fromEmail: true,
        fromName: true,
        toEmail: true,
        direction: true,
        sentAt: true,
        isRead: true,
        isStarred: true,
        body: true,
        folder: true,
      },
    });

    const formatted = formatMessages(messages);

    // Deduplicate: keep first (most recent) per conversationId
    const seen = new Set();
    const deduplicated = formatted.filter((item) => {
      if (!item.conversationId || seen.has(item.conversationId)) return false;
      seen.add(item.conversationId);
      return true;
    });

    // Slice out just the requested page of conversations
    const pageItems = deduplicated.slice(offset, offset + limit);
    // hasMore is a best-effort signal: true if we already know of more
    // deduplicated conversations beyond this page within what we fetched.
    const hasMore = deduplicated.length > offset + limit;

    if (isCacheablePage) {
      // Cache for 30 seconds (first-page only)
      cache.set(cacheKey, { data: pageItems, hasMore }, 30);
    }

    return res.json({ success: true, data: pageItems, hasMore, page, fromCache: false });
  } catch (err) {
    console.error("Conversations error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================
   GET MESSAGES OF CONVERSATION
   GET /api/inbox/conversations/:conversationId/messages
========================================================= */
router.get(
  "/conversations/:conversationId/messages",
  protect,
  async (req, res) => {
    try {
      const { conversationId } = req.params;

      const messages = await prisma.emailMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "asc" },
      });

      res.json({ success: true, data: messages });
    } catch (err) {
      console.error("Messages error:", err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================================================
   MARK CONVERSATION AS READ
   PATCH /api/inbox/conversations/:conversationId/read
========================================================= */
router.patch(
  "/conversations/:conversationId/read",
  protect,
  async (req, res) => {
    try {
      const { conversationId } = req.params;

      await prisma.emailMessage.updateMany({
        where: { conversationId },
        data: { isRead: true },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Mark read error:", err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================================================
   MARK CONVERSATION AS UNREAD
   PATCH /api/inbox/conversations/:conversationId/unread
========================================================= */
router.patch(
  "/conversations/:conversationId/unread",
  protect,
  async (req, res) => {
    try {
      const { conversationId } = req.params;

      await prisma.emailMessage.updateMany({
        where: { conversationId },
        data: { isRead: false },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Mark unread error:", err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================================================
   BATCH MARK AS READ
   PATCH /api/inbox/batch-mark-read
========================================================= */
router.patch("/batch-mark-read", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: true },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, updated: result.count });
  } catch (err) {
    console.error("❌ Batch mark read error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   BATCH MARK AS UNREAD
   PATCH /api/inbox/batch-mark-unread
========================================================= */
router.patch("/batch-mark-unread", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: false },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, updated: result.count });
  } catch (err) {
    console.error("❌ Batch mark unread error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   BATCH HIDE CONVERSATIONS (MOVE TO TRASH)
   PATCH /api/inbox/batch-hide-conversations
========================================================= */
router.patch("/batch-hide-conversations", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { folder: "trash" },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, updated: result.count });
  } catch (err) {
    console.error("❌ Batch hide error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   BATCH MOVE TO INBOX (e.g. from Spam)
   POST /api/inbox/move-to-inbox
========================================================= */
router.post("/move-to-inbox", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { folder: "inbox" },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, moved: result.count });
  } catch (err) {
    console.error("❌ Move to inbox error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   SAVE MESSAGE TO DRAFT
   POST /api/inbox/save-draft
========================================================= */
router.post("/save-draft", protect, async (req, res) => {
  try {
    const {
      to,
      cc,
      subject,
      body,
      emailAccountId,
      conversationId,
      messageId,
    } = req.body;

    if (!emailAccountId) {
      return res
        .status(400)
        .json({ success: false, message: "emailAccountId is required" });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    if (messageId) {
      const updated = await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          toEmail: to || "",
          ccEmail: cc || "",
          subject: subject || "(No subject)",
          body: body || "",
          sentAt: new Date(),
        },
      });

      try {
        allCacheKeys(req.user.id, emailAccountId, "draft").forEach((k) =>
          cache.del(k)
        );
      } catch (e) {}

      return res.json({ success: true, data: updated });
    }

    const draft = await prisma.emailMessage.create({
      data: {
        emailAccountId: Number(emailAccountId),
        conversationId: conversationId || null,
        messageId: `draft-${Date.now()}@${account.email}`,
        fromEmail: account.email,
        fromName: account.senderName || null,
        toEmail: to || "",
        ccEmail: cc || "",
        subject: subject || "(No subject)",
        body: body || "",
        direction: "sent",
        sentAt: new Date(),
        folder: "draft",
        isRead: true,
      },
    });

    try {
      allCacheKeys(req.user.id, emailAccountId, "draft").forEach((k) =>
        cache.del(k)
      );
    } catch (e) {}

    res.json({ success: true, data: draft });
  } catch (err) {
    console.error("❌ Save draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   DELETE DRAFT
   DELETE /api/inbox/delete-draft/:messageId
========================================================= */
router.delete("/delete-draft/:messageId", protect, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { accountId } = req.body;

    await prisma.emailMessage.delete({ where: { id: messageId } });

    try {
      allCacheKeys(req.user.id, accountId, "draft").forEach((k) =>
        cache.del(k)
      );
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   SEARCH
   GET /api/inbox/search?query=&accountId=
========================================================= */
router.get("/search", protect, async (req, res) => {
  try {
    const { query, accountId } = req.query;

    if (!query || !accountId) {
      return res.json({ success: true, data: [] });
    }

    const results = await prisma.emailMessage.findMany({
      where: {
        emailAccountId: Number(accountId),
        OR: [
          { subject: { contains: query, mode: "insensitive" } },
          { fromEmail: { contains: query, mode: "insensitive" } },
          { toEmail: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { sentAt: "desc" },
      take: 200,
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ success: false });
  }
});

router.get("/countries", async (_req, res) => {
  try {
    res.json({ success: true, data: ["India", "USA", "UK", "Canada"] });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch countries" });
  }
});

router.get("/accounts/:id/user", protect, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { email: true },
    });

    if (!account) return res.status(404).json({ success: false });

    res.json({ success: true, userName: account.email.split("@")[0] });
  } catch (err) {
    console.error("User fetch error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/hide-inbox-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing data" });
    }

    await prisma.emailMessage.updateMany({
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "trash" },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Trash move error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/restore-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    await prisma.emailMessage.updateMany({
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "inbox" },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Restore error:", err);
    res.status(500).json({ success: false });
  }
});

router.delete("/permanent-delete-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    await prisma.emailMessage.deleteMany({
      where: { conversationId, emailAccountId: Number(accountId) },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Permanent delete error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/move-to-draft", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Missing conversationId or accountId",
        });
    }

    const result = await prisma.emailMessage.updateMany({
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "draft" },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
    } catch (e) {}

    res.json({ success: true, moved: result.count });
  } catch (err) {
    console.error("❌ Move to draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;