import express from "express";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import dns from "dns/promises";
import { protect } from "../../middlewares/authMiddleware.js";
import { runSyncForAccount } from "../../services/imap.service.js";
import { ImapFlow } from "imapflow";
import cache from "../../utils/cache.js"; // add at top
import {
  startAccountDeletion,
  resumeAccountDeletions,
} from "../../services/accountDeletionWorker.js";

const router = express.Router();
const prisma = new PrismaClient();

// Background delete tuning — kept in one place so the ETA shown to the
// user (on delete) and the ETA recalculated by the worker (during delete)
// agree with each other.
const DELETE_SPEED_PER_MIN = 1200;

// accounts:{userId}:all and accounts:{userId}:group:{groupId} are both used
// as cache keys (see GET / below). A plain `cache.del(`accounts:${userId}`)`
// never actually matched either of those keys, so the accounts cache wasn't
// really being cleared on delete/app-password update. This clears every
// cache entry for a user regardless of the group suffix.
function clearAccountsCache(userId) {
  const prefix = `accounts:${userId}`;
  cache.keys().forEach((key) => {
    if (key.startsWith(prefix)) cache.del(key);
  });
}

function formatRemaining(seconds) {
  if (seconds == null) return "calculating…";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m <= 0) return `${s} sec`;
  return `${m} min ${s} sec`;
}

// Postgres prepared statements support at most 32767 bind params.
// Any deleteMany({ where: { xId: { in: [...] } } }) with a large id list
// must be chunked, or the query will fail once a mailbox gets big enough.
const CHUNK_SIZE = 5000;
function chunkArray(arr, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Suggest IMAP/SMTP hosts (prioritize provider param, then MX records, then provider map)
 * Returns array of suggestions (best-first).
 */
const PROVIDER_MAP = {
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
  },
  gsuite: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
  },
  yahoo: {
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
  },
  outlook: {
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
  },
  rediff: {
    imapHost: "imap.rediffmailpro.com",
    imapPort: 993,
    smtpHost: "smtp.rediffmailpro.com",
    smtpPort: 587,
  },
  amazon: {
    imapHost: "imap.mail.us-east-1.awsapps.com",
    imapPort: 993,
    smtpHost: "smtp.mail.us-east-1.awsapps.com",
    smtpPort: 465,
  },

  // add other providers you want...
};

const UNIVERSAL_PROVIDER_SETTINGS = {
  titan: {
    imapHost: "imap.titan.email",
    smtpHost: "smtp.titan.email",
    imapPort: 993,
    smtpPort: 465,
  },
  namecheap: {
    imapHost: "mail.privateemail.com",
    smtpHost: "mail.privateemail.com",
    imapPort: 993,
    smtpPort: 587,
  },
  zoho: {
    imapHost: "imap.zoho.com",
    smtpHost: "smtp.zoho.com",
    imapPort: 993,
    smtpPort: 587,
  },
  zoho_in: {
    imapHost: "imappro.zoho.in",
    smtpHost: "smtppro.zoho.in",
    imapPort: 993,
    smtpPort: 587,
  },
  gmail: {
    imapHost: "imap.gmail.com",
    smtpHost: "smtp.gmail.com",
    imapPort: 993,
    smtpPort: 587,
  },
  rediff: {
    imapHost: "imap.rediffmailpro.com",
    smtpHost: "smtp.rediffmailpro.com",
    imapPort: 993,
    smtpPort: 587,
  },
  amazon: {
    imapHost: "imap.mail.us-east-1.awsapps.com",
    smtpHost: "smtp.mail.us-east-1.awsapps.com",
    imapPort: 993,
    smtpPort: 465,
  },


};

async function detectProviderFromMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) return null;
    // take highest priority (lowest priority value)
    mx.sort((a, b) => a.priority - b.priority);
    const host = mx[0].exchange.toLowerCase();

    // Heuristics: map common MX host patterns to providers
    if (host.includes("google") || host.includes("google.com")) return "gmail";
    if (host.includes("googlehosted")) return "gmail";
    if (host.includes("zoho")) return "zoho";
    if (host.includes("titan") || host.includes("titan.email")) return "titan";
    if (host.includes("privateemail") || host.includes("mail.privateemail"))
      return "namecheap";
    if (host.includes("hostinger")) return "hostinger";
    if (host.includes("secureserver") || host.includes("smtpout"))
      return "godaddy";
    if (host.includes("yahoodns") || host.includes("mail.yahoo"))
      return "yahoo";
    if (
      host.includes("outlook") ||
      host.includes("office365") ||
      host.includes("protection.outlook")
    )
      return "outlook";
    if (host.includes("rediff")) return "rediff";
    // fallback
    return null;
  } catch (e) {
    return null;
  }
}

async function detectEmailProvider(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    mx.sort((a, b) => a.priority - b.priority);
    const mxHost = mx[0].exchange.toLowerCase();

    // TITAN MAIL (Bluehost, Hostinger, BigRock, etc.)
    if (mxHost.includes("titan.email")) return "titan";

    // NAMECHEAP PRIVATE EMAIL
    if (mxHost.includes("privateemail")) return "namecheap";

    // ZOHO (Global or India)
    if (mxHost.includes("zoho.in")) return "zoho_in";
    if (mxHost.includes("zoho.com")) return "zoho";

    // GOOGLE WORKSPACE / GMAIL
    if (mxHost.includes("google") || mxHost.includes("googlehosted"))
      return "gmail";

    // OFFICE 365
    if (mxHost.includes("outlook") || mxHost.includes("office365"))
      return "office365";

    // GODADDY
    if (mxHost.includes("secureserver")) return "godaddy";

    // HOSTINGER
    if (mxHost.includes("hostinger")) return "hostinger";

    // CPANEL / PLESK EMAIL
    if (mxHost.includes(`mail.${domain}`)) return "cpanel";

    return "unknown";
  } catch (err) {
    return "unknown";
  }
}

/**
 * Main suggestion function.
 * - email: full email like user@domain.com
 * - provider: optional provider string from frontend (e.g., 'bluehost','zoho','gmail')
 */
async function suggestHostsForEmail(email) {
  const domain = email.split("@")[1];
  const provider = await detectEmailProvider(domain);

  if (UNIVERSAL_PROVIDER_SETTINGS[provider]) {
    return [
      {
        reason: `Detected: ${provider}`,
        ...UNIVERSAL_PROVIDER_SETTINGS[provider],
      },
    ];
  }

  // fallback guess
  return [
    {
      reason: "Unknown — guessed from domain",
      imapHost: `imap.${domain}`,
      smtpHost: `smtp.${domain}`,
      imapPort: 993,
      smtpPort: 587,
    },
  ];
}

/* ============================================================
   🟢 CREATE NEW EMAIL ACCOUNT — VERIFY IMAP & SMTP
============================================================ */

router.post("/", protect, async (req, res) => {
  try {
    const {
      email,
      provider,
      imapHost,
      imapPort,
      imapUser,
      smtpHost,
      smtpPort,
      smtpUser,
      encryptedPass,
      authType,
      senderName,
      groupId, // ✅ NEW: Group assignment
    } = req.body;

    // 1. Validation
    if (
      !email ||
      !provider ||
      !imapHost ||
      !imapPort ||
      !imapUser ||
      !smtpHost ||
      !smtpPort ||
      !smtpUser
    ) {
      return res
        .status(400)
        .json({ error: "All connection fields are required" });
    }

    const exists = await prisma.emailAccount.findUnique({ where: { email } });
    if (exists) {
      if (exists.deleted) {
        // Still being permanently deleted in the background — block re-add
        // until the worker finishes and removes the row.
        const remainingEmails = Math.max(
          (exists.totalEmails || 0) - (exists.deletedEmails || 0),
          0
        );
        return res.status(409).json({
          success: false,
          deleting: true,
          message: "This email account is currently being permanently deleted.",
          progress: exists.deleteProgress || 0,
          totalEmails: exists.totalEmails || 0,
          deletedEmails: exists.deletedEmails || 0,
          remainingEmails,
          remainingTime: formatRemaining(exists.estimatedSecondsRemaining),
        });
      }
      return res.status(400).json({ error: "Account already exists" });
    }

    // ✅ Enforce 80-account limit per user
    const accountCount = await prisma.emailAccount.count({
      where: { userId: req.user.id },
    });
    if (accountCount >= 80) {
      return res.status(403).json({
        error: "Account limit reached. You can add a maximum of 80 email accounts.",
        limitReached: true,
        count: accountCount,
      });
    }

    /* -------------------------
       VERIFY IMAP (Incoming)
    -------------------------- */
    const imap = new ImapFlow({
      host: imapHost,
      port: Number(imapPort),
      secure: Number(imapPort) === 993, // SSL for 993
      auth: { user: imapUser || email, pass: encryptedPass },
      tls: { rejectUnauthorized: false },
    });

    // 🔥 FIX 1: Prevent process crash on socket timeouts (common with Zoho/Bluehost)
    imap.on("error", (err) => {
      console.error("⚠️ IMAP Verification Background Error:", err.message);
    });

    try {
      await imap.connect();
      await imap.logout();
    } catch (err) {
      const suggestions = await suggestHostsForEmail(email);
      const domain = email.split("@")[1];
      const detectedProvider = await detectEmailProvider(domain);
      let help = null;

      // Provide Zoho-specific help if auth fails
      if (
        err.message.includes("AUTHENTICATIONFAILED") &&
        ["zoho", "zoho_in"].includes(detectedProvider)
      ) {
        help = `<b>Zoho Requires an App Password</b><br/>1. Log in to Zoho Webmail<br/>2. Settings → Security → App Passwords<br/>3. Ensure <b>IMAP Access</b> is enabled in Mail Accounts settings.`;
      }

      return res.status(400).json({
        success: false,
        error: "IMAP Login Failed: " + err.message,
        suggestion: suggestions[0],
        help,
      });
    }

    /* -------------------------
       VERIFY SMTP (Outgoing)
    -------------------------- */
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      // secure: true for 465 (Implicit SSL), false for 587 (STARTTLS)
      secure: Number(smtpPort) === 465,
      auth: { user: smtpUser || email, pass: encryptedPass },
      // 🔥 FIX 2: Support STARTTLS for Port 587 (Required for Zoho/Gmail/Bluehost)
      requireTLS: Number(smtpPort) === 587,
      tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      },
    });

    try {
      await transporter.verify();
    } catch (err) {
      const suggestions = await suggestHostsForEmail(email);
      return res.status(400).json({
        success: false,
        error: "SMTP Login Failed: " + err.message,
        suggestion: suggestions[0],
      });
    }

    /* -------------------------
       SAVE ACCOUNT & START SYNC
    -------------------------- */
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized. Please login again." });
    }
    const newAccount = await prisma.emailAccount.create({
      data: {
        email,
        provider,
        imapHost,
        imapPort: Number(imapPort),
        imapUser,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser,
        encryptedPass,
        authType,
        senderName: senderName?.trim() || null,
        verified: true,
        user: { connect: { id: req.user.id } },
        ...(groupId ? { group: { connect: { id: parseInt(groupId) } } } : {}), // ✅ NEW
      },
    });

    // ✅ VERY IMPORTANT — CLEAR CACHE
    cache.del(`accounts:${req.user.id}`);

    // Trigger initial sync in background
    runSyncForAccount(prisma, email)
      .then(() => console.log(`⚡ Initial sync completed for ${email}`))
      .catch((e) => console.error("Sync trigger error:", e));

    res.status(201).json(newAccount);

  } catch (err) {
    console.error("CREATE ACCOUNT ERROR:", err);
    res
      .status(500)
      .json({ error: "Internal server error", details: err.message });
  }
});
/* ============================================================
   🟢 UPDATE ACCOUNT
   ============================================================ */
router.put("/:id", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.id);

    const {
      email,
      provider,
      imapHost,
      imapPort,
      imapUser,
      smtpHost,
      smtpPort,
      smtpUser,
      encryptedPass,
      oauthClientId,
      oauthClientSecret,
      refreshToken,
      authType,
    } = req.body;

    const updated = await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        email,
        provider,
        imapHost,
        imapPort: Number(imapPort),
        imapUser,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser,
        encryptedPass,
        oauthClientId,
        oauthClientSecret,
        refreshToken,
        authType,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(500).json({ error: "Failed to update account" });
  }
});


/* ============================================================
   🗑️ DELETE /accounts/:id → INSTANT SOFT DELETE
   ============================================================
   For accounts with thousands of emails, permanently cascading a
   delete synchronously took 10-15 minutes with the user stuck on a
   "Logging out..." screen. This route now does almost nothing itself:

     1. Mark the row deleted (status=DELETING) so it instantly
        disappears from GET /accounts and blocks re-adding the same
        email address.
     2. Kick off the background worker WITHOUT awaiting it.
     3. Respond immediately (~1s).

   The actual permanent deletion (emails, attachments, conversations,
   and finally the EmailAccount row itself) happens in
   accountDeletionWorker.js, in batches, and survives server restarts
   via resumeAccountDeletions().
   ============================================================ */
router.delete("/:id", protect, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: "Invalid ID" });

  console.log(`🟡 Marking account ${id} for background deletion`);

  try {
    // 1️⃣ Check account exists and belongs to this user
    const existing = await prisma.emailAccount.findFirst({
      where: { id, userId: req.user.id },
    });

    if (!existing) {
      console.log("⚠️ Account not found or already deleted.");
      return res.json({ success: true, message: "Account already deleted" });
    }

    if (existing.deleted) {
      // Already mid-deletion (e.g. double click) — don't restart the clock.
      return res.json({
        success: true,
        deleting: true,
        message: "Background cleanup is already in progress for this account.",
        progress: existing.deleteProgress || 0,
      });
    }

    // 2️⃣ Compute a one-time ETA for the delete-status endpoint to show
    // before the worker's first progress update lands.
    const totalEmails = await prisma.emailMessage.count({
      where: { emailAccountId: id },
    });
    const estimatedSecondsRemaining = Math.max(
      Math.ceil((totalEmails / DELETE_SPEED_PER_MIN) * 60),
      0
    );

    // 3️⃣ Soft-delete: this alone is what makes the account disappear from
    // the UI and blocks re-adding the same email — nothing has actually
    // been deleted from the database yet.
    await prisma.emailAccount.update({
      where: { id },
      data: {
        deleted: true,
        deleteStatus: "DELETING",
        deleteStartedAt: new Date(),
        deleteCompletedAt: null,
        totalEmails,
        deletedEmails: 0,
        deleteProgress: totalEmails === 0 ? 100 : 0,
        estimatedSecondsRemaining,
        estimatedDeleteAt: new Date(Date.now() + estimatedSecondsRemaining * 1000),
      },
    });

    // ✅ Clear cache so next GET /accounts reflects the deletion immediately
    clearAccountsCache(req.user.id);

    // 4️⃣ Fire-and-forget the actual permanent deletion — NOT awaited.
    startAccountDeletion(prisma, id);

    console.log(`🟢 Account ${id} hidden from UI — background delete started (${totalEmails} emails)`);
    res.json({
      success: true,
      deleting: true,
      message: "Account removed successfully. Background cleanup has started.",
    });
  } catch (err) {
    console.error("❌ Delete error:", err);

    if (err.code === "P2025") {
      // Record already gone — treat as success and clear cache
      clearAccountsCache(req.user.id);
      return res.json({ success: true, message: "Account already deleted" });
    }

    res.status(500).json({ success: false, error: err.message });
  }
});

/* ============================================================
   📊 GET /accounts/delete-status/:email → BACKGROUND DELETE PROGRESS
   ============================================================ */
router.get("/delete-status/:email", protect, async (req, res) => {
  try {
    const { email } = req.params;

    const account = await prisma.emailAccount.findUnique({ where: { email } });

    if (!account || !account.deleted) {
      // Nothing deleting under this email — safe to (re)create.
      return res.json({ success: true, deleting: false });
    }

    const totalEmails = account.totalEmails || 0;
    const deletedEmails = account.deletedEmails || 0;
    const remainingEmails = Math.max(totalEmails - deletedEmails, 0);

    return res.json({
      success: true,
      deleting: true,
      status: account.deleteStatus,
      progress: account.deleteProgress || 0,
      totalEmails,
      deletedEmails,
      remainingEmails,
      estimatedSecondsRemaining: account.estimatedSecondsRemaining,
      estimatedFinishTime: account.estimatedDeleteAt,
      remainingTime: formatRemaining(account.estimatedSecondsRemaining),
    });
  } catch (err) {
    console.error("❌ delete-status error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ============================================================
   🟢 GET USER ACCOUNTS
   ============================================================ */
// router.get("/", protect, async (req, res) => {
//   try {
//     if (!req.user || !req.user.id) {
//       return res.status(401).json({
//         error: "Unauthorized: req.user missing",
//       });
//     }

//     const accounts = await prisma.emailAccount.findMany({
//       where: { userId: req.user.id },
//       orderBy: { createdAt: "desc" },
//     });

//     return res.json(accounts);
//   } catch (err) {
//     console.error("🔥 GET /accounts error:", err);
//     res.status(500).json({
//       error: "Failed to fetch accounts",
//       details: err.message,
//     });
//   }
// });

// ======================================================
// 🔄 IMMEDIATELY SYNC AND RETURN EMAILS
// ======================================================

/* ============================================================
   📋 GET /accounts → GET ALL ACCOUNTS (WITH SENDER NAME)
   ============================================================ */
router.get("/", protect, async (req, res) => {
  try {
  const groupId = req.query.groupId;

  const cacheKey = groupId
    ? `accounts:${req.user.id}:group:${groupId}`
    : `accounts:${req.user.id}:all`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log("🟢 CACHE HIT: accounts");
      return res.json({ success: true, data: cached });
    }

    const accounts = await prisma.emailAccount.findMany({
      where: {
        userId: req.user.id,
        deleted: false, // hide accounts mid-permanent-delete from the UI immediately

        ...(groupId
          ? { groupId: Number(groupId) }
          : {}),
      },

      select: {
        id: true,
        email: true,
        provider: true,
        senderName: true,
        verified: true,
        createdAt: true,
        groupId: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    cache.set(cacheKey, accounts, 60); // 60 seconds
    return res.json({ success: true, data: accounts });

  } catch (error) {
    console.error("🔥 GET /accounts error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});



router.get("/sync/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const account = await prisma.emailAccount.findUnique({
      where: { email },
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    await runSyncForAccount(prisma, email);

    // NOTE: This route only triggers an IMAP sync — the caller (Refresh
    // button) re-fetches the paginated conversation list separately via
    // GET /api/inbox/conversations/:accountId. Previously this endpoint
    // also loaded every message (with attachments) for the account and
    // returned them, even though nothing consumed that payload — on an
    // account with a large mailbox that alone could take seconds and
    // move a lot of data for no reason.
    res.json({ success: true });
  } catch (err) {
    console.error("SYNC ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// 🟢 GET ACCOUNTS BY EMPLOYEE ID
// ======================================================
router.get("/emp/:empId", protect, async (req, res) => {
  try {
    const empId = req.params.empId;

    const accounts = await prisma.emailAccount.findMany({
      where: { empId },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      success: true,
      data: accounts,
    });
  } catch (err) {
    console.error("❌ Error fetching accounts by empId:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch accounts",
      details: err.message,
    });
  }
});

// GET /api/accounts/:accountId/unread
router.get("/:accountId/unread", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!accountId) {
      return res.status(400).json({ error: "Invalid account ID" });
    }

    const unreadCount = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        isRead: false,
      },
    });

    res.json({ success: true, unread: unreadCount });
  } catch (err) {
    console.error("❌ Unread count error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch unread count",
      details: err.message,
    });
  }
});

/* ============================================================
   🔧 PATCH /accounts/:id/sender-name → UPDATE SENDER NAME
   ============================================================ */
router.patch("/:id/sender-name", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { senderName } = req.body;

    if (!senderName || !senderName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Sender name is required",
      });
    }

    // Verify account ownership
    const account = await prisma.emailAccount.findFirst({
      where: {
        id: parseInt(id),
        userId: req.user.id,
      },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Email account not found",
      });
    }

    // Update sender name
    const updated = await prisma.emailAccount.update({
      where: { id: parseInt(id) },
      data: { senderName: senderName.trim() },
    });

    return res.json({
      success: true,
      message: "Sender name updated successfully",
      data: {
        id: updated.id,
        email: updated.email,
        senderName: updated.senderName,
      },
    });
  } catch (error) {
    console.error("❌ Error updating sender name:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update sender name",
      error: error.message,
    });
  }
});
/* ============================================================
   🔑 PATCH /accounts/:id/app-password → UPDATE APP PASSWORD
   (Re-verifies IMAP & SMTP before saving)
   ============================================================ */
router.patch("/:id/app-password", protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!newPassword || !newPassword.trim()) {
      return res.status(400).json({ success: false, error: "New password is required." });
    }

    // Verify ownership
    const account = await prisma.emailAccount.findFirst({
      where: { id, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found." });
    }

    // Re-verify IMAP with new password
    const imap = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapPort === 993,
      auth: { user: account.imapUser || account.email, pass: newPassword.trim() },
      tls: { rejectUnauthorized: false },
    });
    imap.on("error", (err) => console.error("⚠️ IMAP verify error:", err.message));

    try {
      await imap.connect();
      await imap.logout();
    } catch (err) {
      return res.status(400).json({ success: false, error: "IMAP verification failed: " + err.message });
    }

    // Re-verify SMTP with new password
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpPort === 465,
      auth: { user: account.smtpUser || account.email, pass: newPassword.trim() },
      requireTLS: account.smtpPort === 587,
      tls: { rejectUnauthorized: false, minVersion: "TLSv1.2" },
    });

    try {
      await transporter.verify();
    } catch (err) {
      return res.status(400).json({ success: false, error: "SMTP verification failed: " + err.message });
    }

    // Save new password
    await prisma.emailAccount.update({
      where: { id },
      data: { encryptedPass: newPassword.trim() },
    });

    // Clear cache
    clearAccountsCache(req.user.id);

    return res.json({ success: true, message: "App password updated successfully." });
  } catch (err) {
    console.error("❌ app-password update error:", err);
    return res.status(500).json({ success: false, error: "Failed to update password." });
  }
});

// Re-exported so server.js can resume any deletions interrupted by a
// restart, the same way it resumes in-flight campaigns.
export { resumeAccountDeletions };

export default router;