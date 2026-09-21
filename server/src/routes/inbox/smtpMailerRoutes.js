// server/src/routes/inbox/smtpMailerRoutes.js
import express from "express";
import nodemailer from "nodemailer";
import multer from "multer";
import crypto from "crypto";
import { resolveSecret } from "../../utils/crypto.js";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  canAccessAccount,
  canAccessConversation,
} from "../../middlewares/accountAccess.js";
import cache from "../../utils/cache.js";
import prisma from "../../prismaClient.js"; // ✅ shared singleton — no extra connection pool

const router = express.Router();

// Configure Multer (Memory Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// Login required (this route used to be open to anyone), and the sender
// mailbox must belong to the caller.
router.post("/send", protect, upload.array("attachments"), async (req, res) => {
  try {
    const {
      to,
      cc,
      subject,
      body,
      emailAccountId,
      conversationId,
      inReplyToId,
    } = req.body;

    // 1. Validation
    if (!to || !emailAccountId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (to, emailAccountId)",
      });
    }

    // 2. Fetch Account (ownership first — 404 for other people's mailboxes)
    if (!(await canAccessAccount(req.user, emailAccountId))) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }
    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
      include: { user: { select: { email: true, empId: true } } },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    const authenticatedEmail = account.smtpUser || account.email;
    const senderName = account.senderName || null;

    /* ============================================================
       🧠 CONVERSATION LOGIC (FIXED)
       ============================================================ */
    let finalConversationId = null;

    // A) If ID provided, verify it exists.
    if (
      conversationId &&
      conversationId !== "undefined" &&
      conversationId !== "null"
    ) {
      // Note: Since your DB uses String IDs, we don't wrap this in Number() if it's a UUID
      // But if your frontend sends numeric IDs, check your schema.
      // Based on error, it's a String.
      const exists = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { emailAccountId: true },
      });
      // Only attach to a thread the caller may see.
      if (exists && (await canAccessConversation(req.user, conversationId))) {
        finalConversationId = conversationId;
      }
    }

    // B) Find by Email
    if (!finalConversationId) {
      // const existing = await prisma.conversation.findFirst({
      //   where: {
      //     AND: [
      //       { emailAccountId: Number(emailAccountId) },
      //       { participants: { contains: to } },
      //     ],
      //   },
      // });
      const existing = await prisma.conversation.findFirst({
        where: {
          OR: [{ toRecipients: to }, { participants: { contains: to } }],
        },
      });

      if (existing) {
        finalConversationId = existing.id;
        // await prisma.conversation.update({
        //   where: { id: existing.id },
        //   data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
        // });
        await prisma.conversation.update({
          where: { id: existing.id },
          data: {
            lastMessageAt: new Date(),
            messageCount: { increment: 1 },
          },
        });
      } else {
        // C) Create NEW Conversation (FIXED: Added ID)
        console.log("🆕 Creating new conversation for:", to);

        // 🛡️ GENERATE ID MANUALLY
        const newId = crypto.randomUUID();

        // const newConv = await prisma.conversation.create({
        //   data: {
        //     id: newId, // 👈 THE MISSING PIECE!
        //     emailAccountId: Number(emailAccountId),
        //     subject: subject || "(No Subject)",
        //     participants: `${authenticatedEmail}, ${to}`,
        //     toRecipients: to,
        //     initiatorEmail: authenticatedEmail,
        //     lastMessageAt: new Date(),
        //     messageCount: 1,
        //     unreadCount: 0,
        //   },
        // });
        const newConv = await prisma.conversation.create({
          data: {
            id: newId,
            subject: subject || "(No Subject)",
            participants: `${authenticatedEmail}, ${to}${cc ? `, ${cc}` : ""}`,
            toRecipients: to,
            ccRecipients: cc || null,
            initiatorEmail: authenticatedEmail,
            lastMessageAt: new Date(),
            messageCount: 1,
            unreadCount: 0,

            // ✅ THIS IS THE FIX
            account: {
              connect: {
                id: Number(emailAccountId),
              },
            },
          },
        });

        finalConversationId = newConv.id;
      }
    }

    /* ==============================
      4. CONFIGURE SMTP
      ============================== */
    const smtpPort = Number(account.smtpPort) || 465;
    const isSecure = smtpPort === 465;

    let smtpPassword = null;
    try {
      smtpPassword = resolveSecret(account.encryptedPass);
    } catch (err) {
      console.error(
        `Cannot read stored password for ${account.email}:`,
        err.message,
      );
    }

    if (!smtpPassword) {
      return res.status(400).json({
        success: false,
        message: "SMTP password missing for this account",
      });
    }

    const domain = authenticatedEmail.split("@")[1] || "localhost.localdomain";

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: smtpPort,
      secure: isSecure,
      name: domain,
      auth: {
        user: authenticatedEmail,
        pass: smtpPassword,
      },
      tls: { rejectUnauthorized: false },
    });

    /* ==============================
       5. PREPARE ATTACHMENTS
       ============================== */
    // For Nodemailer (Buffer)
    const smtpAttachments =
      req.files?.map((file) => ({
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      })) || [];

    // For Database (Metadata only for now, ideally upload to R2 here too)
    const attachmentRecords =
      req.files?.map((file) => ({
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageUrl: "", // Add R2 upload here if needed
        hash: "",
      })) || [];

    /* ==============================
       6. SEND EMAIL
       ============================== */

    const info = await transporter.sendMail({
      from: senderName
        ? `"${senderName}" <${authenticatedEmail}>`
        : authenticatedEmail,
      to,
      cc,
      subject,
      html: body,
    });

    console.log("📤 Email Sent! ID:", info.messageId);

    /* ==============================
       7. SAVE TO DATABASE
       ============================== */
    const savedMessage = await prisma.emailMessage.create({
      data: {
        emailAccountId: Number(emailAccountId),
        conversationId: finalConversationId,
        messageId: info.messageId,
        fromEmail: authenticatedEmail,
        fromName: senderName,
        toEmail: to,
        ccEmail: cc || null,
        subject: subject || "(No Subject)",
        body,
        direction: "sent",
        sentAt: new Date(),
        folder: "sent",
        isRead: true,
        attachments:
          attachmentRecords.length > 0
            ? { create: attachmentRecords }
            : undefined,
      },
      include: { attachments: true },
    });

    // 🔥 CLEAR INBOX CACHE AFTER SENDING MAIL
    try {
      const userId = account.userId;
      const MONTH_FILTERS = ["current", "last", "three"];
      const FOLDERS = ["inbox", "sent", "spam", "trash", "draft"];

      // Clear all folder + monthFilter combinations (matches inbox.js key format)
      FOLDERS.forEach((folder) => {
        MONTH_FILTERS.forEach((mf) => {
          cache.del(`inbox:${userId}:${emailAccountId}:${folder}:${mf}`);
        });
      });

      // Also clear accounts cache so unread counts refresh on next load
      cache.del(`accounts:${userId}`);

      console.log("🧹 Cache cleared for all folders/filters");
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    return res.json({ success: true, data: savedMessage });
  } catch (error) {
    console.error("❌ SMTP SEND ERROR:", error);
    // SMTP errors are useful to the user ("invalid login", "mailbox full");
    // database/internal details are not.
    const isSmtp = Boolean(
      error.responseCode || error.command || error.code?.startsWith?.("E"),
    );
    return res.status(isSmtp ? 502 : 500).json({
      success: false,
      message: isSmtp
        ? `Sending failed: ${error.response || error.message}`
        : "Failed to send email",
    });
  }
});

export default router;
