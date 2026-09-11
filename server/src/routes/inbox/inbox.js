// server/src/routes/inbox/inbox.js
import express from "express";
import prisma from "../../prismaClient.js";
import { protect } from "../../middlewares/authMiddleware.js";
import cache from "../../utils/cache.js";
import {
  EMAIL_RETENTION_DAYS,
  RETENTION_EXEMPT_FOLDERS,
  retentionCutoff,
} from "../../config/emailRetention.js";

// ─────────────────────────────────────────────
// Indexes these queries rely on (schema.prisma, EmailMessage):
//   @@index([emailAccountId, folder, sentAt])            ← conversation list
//   @@index([emailAccountId, folder, direction, isRead]) ← unread badges
//   @@index([conversationId, sentAt])                    ← open a thread
//   @@index([createdAt])                                 ← retention purge
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
   HELPER: Retention filter
   Emails are kept for EMAIL_RETENTION_DAYS from arrival and
   then purged by the worker (services/emailRetention.service.js).
   The purge runs every ~10 min, so the API also filters by the
   cutoff: an email never shows up after its window has ended,
   even if the worker hasn't removed the row yet.
   Drafts are exempt from retention.
========================================================= */
function withinRetention(folder) {
  if (RETENTION_EXEMPT_FOLDERS.includes(folder)) return {};
  return { createdAt: { gte: retentionCutoff() } };
}

// Upper bound on rows scanned per list request. With a 7-day window a
// single folder is normally a few hundred rows; this only guards
// against an unusually busy mailbox.
const MAX_SCAN_ROWS = 20000;

/* =========================================================
   HELPER: Build ALL cache keys for an account+folder
   The month filter was removed (only 7 days of mail exist),
   but the old key suffixes are still cleared here and in
   smtpMailerRoutes.js so nothing stale survives a deploy.
========================================================= */
const MONTH_FILTERS = ["current", "last", "three"];
const CACHE_SUFFIX = "current";

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

// For routes that only receive a conversationId. Uses the
// (conversationId, sentAt) index, so it's a single cheap lookup.
async function clearCachesForConversation(userId, conversationId) {
  try {
    const msg = await prisma.emailMessage.findFirst({
      where: { conversationId },
      select: { emailAccountId: true },
    });
    if (msg) clearAllFolderCaches(userId, msg.emailAccountId);
  } catch (e) {
    console.warn("Cache clear failed:", e.message);
  }
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
        ...withinRetention("inbox"),
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
        emailAccountId: { in: accountIds.map(Number).filter(Boolean) },
        direction: "received",
        isRead: false,
        folder: "inbox",
        ...withinRetention("inbox"),
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
       &limit=10      (default 10, max 100)
       &page=0        (0-indexed)
       &bust=<any>    (skip server cache — Refresh button)

   Returns the latest message of each conversation in the
   folder, newest first, for the retention window (7 days).
   `monthFilter` is still accepted but ignored, so an older
   frontend build keeps working during deploy.

   WHY TWO QUERIES
   The previous version loaded up to 2000 rows INCLUDING the
   full HTML body of every email, only to keep 10 of them and
   show 100 characters of each. Bodies are often 20–200 KB,
   so a single folder open could move many MB from Postgres.

     1) Scan only (id, conversationId) for the folder, newest
        first — tiny rows, served by the
        (emailAccountId, folder, sentAt) index.
     2) Load full rows (with body) for just the page's ids.

   Pagination is now exact: `hasMore` is correct at any depth,
   instead of being limited to what fit in the old 2000-row cap.
========================================================= */
router.get("/conversations/:accountId", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!accountId) {
      return res.status(400).json({ success: false, error: "Invalid account id" });
    }
    const { folder = "inbox", bust } = req.query;

    // ── Pagination params ────────────────────────────────────
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const offset = page * limit;

    const cacheKey = `inbox:${req.user.id}:${accountId}:${folder}:${CACHE_SUFFIX}`;
    const isCacheablePage = page === 0 && limit === 10;
    const cached = !bust && isCacheablePage ? cache.get(cacheKey) : null;

    // Cache hit returns instantly. No IMAP sync is triggered from here —
    // sync is done by the worker (every 2 min) or the Refresh button.
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        hasMore: cached.hasMore,
        page,
        fromCache: true,
        retentionDays: EMAIL_RETENTION_DAYS,
      });
    }

    const msgWhere = {
      emailAccountId: accountId,
      ...withinRetention(folder),
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

    // ── 1) Lightweight scan: ids only, newest first ──────────
    const scan = await prisma.emailMessage.findMany({
      where: msgWhere,
      orderBy: { sentAt: "desc" },
      select: { id: true, conversationId: true },
      take: MAX_SCAN_ROWS,
    });

    // First row seen per conversation = its latest message
    const seen = new Set();
    const latestIds = [];
    for (const row of scan) {
      if (!row.conversationId || seen.has(row.conversationId)) continue;
      seen.add(row.conversationId);
      latestIds.push(row.id);
    }

    const pageIds = latestIds.slice(offset, offset + limit);
    const hasMore = latestIds.length > offset + limit;

    // ── 2) Full rows (with body) for this page only ──────────
    let pageItems = [];
    if (pageIds.length > 0) {
      const rows = await prisma.emailMessage.findMany({
        where: { id: { in: pageIds } },
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
      const byId = new Map(rows.map((r) => [r.id, r]));
      pageItems = formatMessages(pageIds.map((id) => byId.get(id)).filter(Boolean));
    }

    if (isCacheablePage) {
      cache.set(cacheKey, { data: pageItems, hasMore }, 30); // 30 s, first page only
    }

    return res.json({
      success: true,
      data: pageItems,
      hasMore,
      page,
      fromCache: false,
      retentionDays: EMAIL_RETENTION_DAYS,
    });
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

      // Without this, the 30 s list cache could show the conversation as
      // unread again on the next background poll.
      await clearCachesForConversation(req.user.id, conversationId);

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

      await clearCachesForConversation(req.user.id, conversationId);

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