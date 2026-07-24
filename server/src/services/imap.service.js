import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import pLimit from "p-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { decrypt } from "../utils/crypto.js";

dotenv.config();

/* ======================================================
   LOGGING SETUP
====================================================== */
const LOG_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const ERROR_LOG_FILE = path.join(LOG_DIR, "imap-errors.log");

function logError(accountEmail, msg) {
  const line = `[${new Date().toISOString()}] [${accountEmail}] ${msg}\n`;
  console.error(line.trim());
  fs.appendFileSync(ERROR_LOG_FILE, line);
}

/* ======================================================
   FOLDER DETECTION
====================================================== */
function detectFolderType(name, special) {
  const n = name.toLowerCase();
  const s = (special || "").toLowerCase();
  if (n === "inbox" || n.startsWith("inbox") || s.includes("inbox")) return "inbox";
  if (n.includes("sent") || n.includes("outbox") || n.includes("sent items") || n.includes("sent mail") || s.includes("sent")) return "sent";
  if (n.includes("spam") || n.includes("junk") || n.includes("bulk") || s.includes("junk")) return "spam";
  if (n.includes("trash") || n.includes("bin") || n.includes("deleted")) return "trash";
  return null;
}

/* ======================================================
   DERIVE STABLE CONVERSATION ID FROM THREAD HEADERS
====================================================== */
function deriveConversationId(accountId, parsed) {
  const inReplyTo = parsed.inReplyTo;
  const references = parsed.references;
  let rootId = null;

  if (references) {
    const refs = Array.isArray(references) ? references : references.split(/\s+/);
    if (refs.length > 0) rootId = refs[0].trim();
  }
  if (!rootId && inReplyTo) {
    rootId = (Array.isArray(inReplyTo) ? inReplyTo[0] : inReplyTo).trim();
  }

  // Use root message-ID if found, else this message's own ID.
  const rawKey = rootId || parsed.messageId || `uid-${Date.now()}`;

  // WHY HASH: raw message IDs contain slashes, angle brackets, colons, and @ signs
  // (e.g. <pr/14@github.com>). Embedding them in a URL path breaks Express routing
  // because the slash is treated as a path separator even after %2F encoding —
  // many reverse proxies decode %2F before Express sees it.
  // SHA-256 → 24-char hex string: always URL-safe, still deterministic per thread.
  const hash = crypto
    .createHash("sha256")
    .update(`${accountId}:${rawKey}`)
    .digest("hex")
    .slice(0, 24);

  return `${accountId}_t_${hash}`;
}

/* ======================================================
   SAVE TO DATABASE
====================================================== */
async function saveEmailToDB(prisma, account, parsed, msg, direction, folder) {
  const messageId = parsed.messageId || msg.envelope?.messageId || `uid-${msg.uid}`;
  const accountId = Number(account.id);

  const exists = await prisma.emailMessage.findUnique({
    where: { emailAccountId_messageId: { emailAccountId: accountId, messageId } },
  });
  if (exists) return false;

  const from = parsed.from?.value?.[0];
  const fromEmail = from?.address || "";
  const fromName = from?.name || null;
  const toEmail = parsed.to?.value?.map(v => v.address).join(", ") || "";
  const ccEmail = parsed.cc?.value?.map(v => v.address).join(", ") || "";
  const htmlBody = parsed.html || parsed.text || "";
  const conversationId = deriveConversationId(accountId, parsed);

  await prisma.conversation.upsert({
    where: { id: conversationId },
    update: {
      lastMessageAt: parsed.date || new Date(),
      messageCount: { increment: 1 },
    },
    create: {
      id: conversationId,
      emailAccountId: accountId,
      subject: parsed.subject || "(No subject)",
      participants: `${fromEmail}, ${toEmail}`,
      toRecipients: toEmail,
      initiatorEmail: fromEmail,
      lastMessageAt: parsed.date || new Date(),
      messageCount: 1,
      unreadCount: direction === "received" ? 1 : 0,
    },
  });

  await prisma.emailMessage.create({
    data: {
      emailAccountId: accountId,
      messageId,
      conversationId,
      subject: parsed.subject || "(No Subject)",
      fromEmail,
      fromName,
      toEmail,
      ccEmail,
      body: htmlBody,
      direction,
      folder,
      sentAt: parsed.date || new Date(),
      isRead: direction === "sent",
    },
  });

  return true;
}

/* ======================================================
   UID STATE — uses `lastUid` field in your SyncState schema
====================================================== */
async function getLastUid(prisma, accountId, folder) {
  try {
    const state = await prisma.syncState.findFirst({
      where: { accountId: Number(accountId), folder },
    });
    return state?.lastUid || 0;
  } catch (e) {
    console.warn(`getLastUid failed [${folder}]:`, e.message);
    return 0;
  }
}

async function saveLastUid(prisma, accountId, folder, lastUid) {
  try {
    const existing = await prisma.syncState.findFirst({
      where: { accountId: Number(accountId), folder },
    });
    if (existing) {
      await prisma.syncState.update({ where: { id: existing.id }, data: { lastUid } });
    } else {
      await prisma.syncState.create({ data: { accountId: Number(accountId), folder, lastUid } });
    }
  } catch (e) {
    console.warn(`saveLastUid failed [${folder}]:`, e.message);
  }
}

/* ======================================================
   SYNC ENGINE — UID-BASED INCREMENTAL SYNC

   WHY UID-BASED:
   - IMAP UIDs are monotonically increasing integers assigned by the server
   - Every new email gets a UID higher than all previous emails
   - So "fetch UIDs > lastUid" is a perfect, zero-miss way to get new emails
   - Date-based (SINCE) was broken because email.sentAt is the date the
     sender wrote it, not when it arrived — a 3-day-old email sent today
     would be missed if our since-date was yesterday

   HOW IT WORKS:
   - First sync: fetch last 30 days by date, save max UID seen
   - Next sync: search UID lastUid+1:* — only emails newer than last sync
   - Each sync saves new maxUid so next sync starts exactly where this left off
====================================================== */
const activeSyncs = new Set();

async function syncImap(prisma, account) {
  if (activeSyncs.has(account.id)) return;
  activeSyncs.add(account.id);
  console.log(`🔄 Syncing: ${account.email}`);

  let client;
  let imapPassword = null;

  if (typeof account.encryptedPass === "string") {
    imapPassword = account.encryptedPass.includes(":")
      ? decrypt(account.encryptedPass)
      : account.encryptedPass;
  }

  if (!imapPassword) {
    logError(account.email, "Missing IMAP password");
    activeSyncs.delete(account.id);
    return;
  }

  try {
    client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: Number(account.imapPort) === 993,
      auth: { user: account.imapUser || account.email, pass: imapPassword },
      tls: { rejectUnauthorized: false },
      logger: false,
    });

    client.on("error", err => logError(account.email, `IMAP error: ${err.message}`));
    await client.connect();

    const mailboxes = await client.list({ recursive: true });
    const folders = [];
    for (const box of mailboxes) {
      const type = detectFolderType(box.path, box.specialUse);
      if (type) folders.push({ path: box.path, type });
    }

    if (!folders.length) {
      logError(account.email, "❌ No folders detected");
      return;
    }

    // console.log("📂 Folders:", folders.map(f => f.type).join(", "));

    for (const { path: folderPath, type } of folders) {
      const lock = await client.getMailboxLock(folderPath);
      try {
        const mailbox = await client.mailboxOpen(folderPath);
        if (!mailbox?.exists) continue;

        const lastUid = await getLastUid(prisma, account.id, type);
        let uids = [];

        if (lastUid === 0) {
          // ── FIRST SYNC: date-based to avoid downloading years of history ──
          const since = new Date();
          since.setDate(since.getDate() - 30);
          uids = await client.search({ since }, { uid: true });
          console.log(`📅 [${type}] First sync: ${uids.length} UIDs (last 30 days)`);
        } else {
          // ── INCREMENTAL SYNC: UID range only ──
          // `lastUid+1:*` means "all UIDs from lastUid+1 to the end of the mailbox"
          const allUids = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
          // Filter out lastUid itself (IMAP always includes the boundary in range responses)
          uids = allUids.filter(uid => uid > lastUid);
          console.log(`📬 [${type}] Incremental: ${uids.length} new UIDs after UID ${lastUid}`);
        }

        if (!uids.length) {
          console.log(`✅ [${type}] Up to date`);
          continue;
        }

        const batch = pLimit(5);
        let maxUidSeen = lastUid;
        let newCount = 0;

        await Promise.all(
          uids.slice(-500).map(uid =>
            batch(async () => {
              try {
                const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
                if (!msg?.source) return;

                const parsed = await simpleParser(msg.source);
                const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() || "";
                const direction = fromAddr === account.email.toLowerCase() ? "sent" : "received";

                const saved = await saveEmailToDB(prisma, account, parsed, msg, direction, type);
                if (saved) newCount++;
                if (uid > maxUidSeen) maxUidSeen = uid;

              } catch (e) {
                logError(account.email, `UID ${uid}: ${e.message}`);
              }
            })
          )
        );

        if (maxUidSeen > lastUid) {
          await saveLastUid(prisma, account.id, type, maxUidSeen);
          // console.log(`💾 [${type}] lastUid=${maxUidSeen} | ${newCount} new emails saved`);
        }

      } finally {
        lock.release();
      }
    }

  } catch (err) {
    logError(account.email, `Fatal sync error: ${err.message}`);
  } finally {
    activeSyncs.delete(account.id);
    if (client) await client.logout().catch(() => {});
    console.log(`✅ Finished: ${account.email}`);
  }
}

/* ======================================================
   PUBLIC EXPORTS
====================================================== */
export async function runSync(prisma) {
  const accounts = await prisma.emailAccount.findMany({ where: { verified: true } });
  const limit = pLimit(2);
  await Promise.allSettled(accounts.map(acc => limit(() => syncImap(prisma, acc))));
}

export async function runSyncForAccount(prisma, email) {
  const acc = await prisma.emailAccount.findUnique({ where: { email } });
  if (acc) await syncImap(prisma, acc);
}