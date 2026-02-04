//  server/src/routes/inbox/inbox.js
import express from "express";
import prisma from "../../prismaClient.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { runSyncForAccount } from "../../services/imap.service.js";
import cache from "../../utils/cache.js";


function extractNameOrEmail(value) {
  if (!value) return "Unknown";

  const match = value.match(/(.*)<(.+)>/);

  if (match) {
    const name = match[1].replace(/["']/g, "").trim();
    const email = match[2].trim();
    return name || email;
  }

  return value.trim();
}

const router = express.Router();

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
      },
    });

    res.json({
      success: true,
      data: { inboxUnread: count },
    });
  } catch (err) {
    console.error("Unread error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   GET CONVERSATIONS
   GET /api/inbox/conversations/:accountId
========================================================= */
router.get("/conversations/:accountId", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    const { folder = "inbox" } = req.query;

    const cacheKey = `inbox:${req.user.id}:${accountId}:${folder}`;
    
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });

    // 🔥 ALWAYS sync first (important!)
    // if (account) {
    //   await runSyncForAccount(prisma, account.email);
    // }

    // Then check cache
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: inbox");

      // 🔄 background sync (NON-BLOCKING)
      // 🔄 background sync (NON-BLOCKING)
      runSyncForAccount(prisma, account.email)
      .then(() => {
        cache.del(cacheKey); // ✅ clear cache after new emails
      })
      .catch(err => console.error(err));



      return res.json({ success: true, data: cached });
    }


    let whereCondition = {
      emailAccountId: accountId,
    };

    // 🔹 Folder-based filtering
    if (folder === "inbox") {
      whereCondition = {
        ...whereCondition,
        folder: "inbox",
        direction: "received",
      };
    }

    if (folder === "sent") {
      whereCondition = {
        ...whereCondition,
        folder: "sent",
        direction: "sent",
      };
    }

    if (folder === "spam") {
      whereCondition = {
        ...whereCondition,
        folder: "spam",
      };
    }

    if (folder === "trash") {
      whereCondition = {
        ...whereCondition,
        folder: "trash",
      };
    }

    const messages = await prisma.emailMessage.findMany({
      where: whereCondition,
      orderBy: { sentAt: "desc" },
      include: {
        conversation: true,
      },
    });

    const formatted = messages.map((m) => ({
      conversationId: m.conversationId,
      subject: m.subject || "(No subject)",

      displayName:
        m.direction === "sent"
          ? extractNameOrEmail(m.toEmail?.split(",")[0])
          : extractNameOrEmail(m.fromName || m.fromEmail),

      displayEmail:
        m.direction === "sent"
          ? m.toEmail?.split(",")[0]
          : m.fromEmail,

      initiatorEmail: m.fromEmail,
      lastSenderEmail: m.fromEmail,
      lastDate: m.sentAt,
      lastBody: m.body?.replace(/<[^>]*>/g, "").slice(0, 100) || "",
      unreadCount: m.isRead ? 0 : 1,
      messageCount: 1,
      isStarred: m.isStarred,
    }));

    // ✅ Store in cache (30 seconds like inbox behavior)
    cache.set(cacheKey, formatted, 30);

    return res.json({ success: true, data: formatted });
  } catch (err) {
    console.error("Conversations error:", err);
    res.status(500).json({ success: false });
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
router.patch( "/conversations/:conversationId/read", protect, async (req, res) => {
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
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ success: false });
  }
});


router.get("/countries", async (req, res) => {
  try {
    const countries = ["India", "USA", "UK", "Canada"]; // or from DB
    res.json({ success: true, data: countries });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch countries" });
  }
});

router.get("/accounts/:id/user", protect, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { email: true },
    });

    if (!account) {
      return res.status(404).json({ success: false });
    }

    res.json({
      success: true,
      userName: account.email.split("@")[0],
    });
  } catch (err) {
    console.error("User fetch error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/hide-inbox-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false, message: "Missing data" });
    }

    await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        folder: "trash",
      },
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
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        folder: "inbox",
      },
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
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Permanent delete error:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
