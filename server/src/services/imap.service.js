import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import pLimit from "p-limit";
import fs from "fs";
import path from "path";
// import { uploadToR2WithHash, generateHash } from "./r2.js";
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
   HELPERS
====================================================== */

function detectFolderType(name, special) {
  const n = name.toLowerCase();
  const s = (special || "").toLowerCase();

  // Inbox
  if (n === "inbox" || n.startsWith("inbox") || s.includes("inbox"))
    return "inbox";

  // Sent
  if (
    n.includes("sent") ||
    n.includes("outbox") ||
    n.includes("sent items") ||
    n.includes("sent mail") ||
    s.includes("sent")
  )
    return "sent";

  // Spam
  if (
    n.includes("spam") ||
    n.includes("junk") ||
    n.includes("bulk") ||
    s.includes("junk")
  )
    return "spam";

  // Trash
  if (
    n.includes("trash") ||
    n.includes("bin") ||
    n.includes("deleted")
  )
    return "trash";

  return null;
}

/* ======================================================
   SAVE TO DATABASE
====================================================== */
async function saveEmailToDB(prisma, account, parsed, msg, direction, folder) {
  const messageId =
    parsed.messageId || msg.envelope?.messageId || `uid-${msg.uid}`;
  const accountId = Number(account.id);

  const exists = await prisma.emailMessage.findUnique({
    where: {
      emailAccountId_messageId: {
        emailAccountId: accountId,
        messageId,
      },
    },
  });

  if (exists) return;

  const from = parsed.from?.value?.[0];
  const to = parsed.to?.value?.[0];

  const fromEmail = from?.address || "";
  const fromName = from?.name || null;

  const toEmail = parsed.to?.value?.map(v => v.address).join(", ") || "";
  const toName = to?.name || null;
const ccEmail = parsed.cc?.value?.map(v => v.address).join(", ") || "";

let htmlBody = parsed.html || parsed.text || "";
const cidMap = {};
const attachmentsMeta = [];

// const cidMap = {};
// let attachmentsMeta = [];

// if (parsed.attachments?.length) {
//   for (const att of parsed.attachments) {
//     try {
//       const hash = generateHash(att.content);
//       const key = `${hash}-${accountId}-${Date.now()}`;
//       const url = await uploadToR2WithHash(att.content, att.contentType, key);

//       if (att.cid) {
//         cidMap[`cid:${att.cid}`] = url;
//       }

//       attachmentsMeta.push({
//         filename: att.filename,
//         mimeType: att.contentType,
//         size: att.content.length,
//         storageUrl: url,
//         hash,
//       });
//     } catch (e) {
//       logError(account.email, `Attachment failed: ${e.message}`);
//     }
//   }
// }

for (const cid in cidMap) {
  htmlBody = htmlBody.replaceAll(cid, cidMap[cid]);
}


  // Ensure conversation exists (fix FK error)
  // Make conversation id globally unique per account
  const conversationId = `${accountId}:${messageId}`;

  await prisma.conversation.upsert({
    where: { id: conversationId },
    update: {},
    create: {
      id: conversationId,
      emailAccountId: accountId,
      subject: parsed.subject || "(No subject)",
    },
  });



await prisma.emailMessage.create({
  data: {
    emailAccountId: accountId,
    messageId,
    conversationId: conversationId, // ✅ FIXED
    subject: parsed.subject || "(No Subject)",
    fromEmail,
    fromName,
    toEmail,
    ccEmail,
    body: htmlBody,
    direction,
    folder,
    sentAt: parsed.date || new Date(),
  },
});


}

/* ======================================================
   SYNC ENGINE
====================================================== */

const activeSyncs = new Set();

async function syncImap(prisma, account) {
  if (activeSyncs.has(account.id)) return;
  activeSyncs.add(account.id);

  console.log(`🔄 Syncing: ${account.email}`);

  let client;

    let imapPassword = null;

    if (typeof account.encryptedPass === "string") {
      if (account.encryptedPass.includes(":")) {
        imapPassword = decrypt(account.encryptedPass);
      } else {
        imapPassword = account.encryptedPass;
      }
    }

    if (!imapPassword) {
      logError(account.email, "Missing IMAP password");
      activeSyncs.delete(account.id); // ✅ IMPORTANT FIX
      return;
    }



    try {
    client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: Number(account.imapPort) === 993,
      auth: {
        user: account.imapUser || account.email,
        pass: imapPassword,   // ✅ fixed
      },
      tls: { rejectUnauthorized: false },
      logger: false,
    });


    client.on("error", err =>
      logError(account.email, `IMAP error: ${err.message}`)
    );

    await client.connect();

    // ✅ CRITICAL FIX: recursive listing
    const mailboxes = await client.list({ recursive: true });

    const folders = [];

    for (const box of mailboxes) {
      const type = detectFolderType(box.path, box.specialUse);
      if (type) folders.push({ path: box.path, type });
    }

    if (!folders.length) {
      logError(account.email, "❌ No folders detected from IMAP");
      return;
    }

    console.log("📂 Using folders:", folders);

    for (const { path, type } of folders) {
      const lock = await client.getMailboxLock(path);
      try {
        await client.mailboxOpen(path);

        const uids = await client.search({ all: true });
        if (!uids.length) continue;

        const batch = pLimit(5);

        await Promise.all(
          uids.slice(-200).map(uid =>
            batch(async () => {
              try {
                const msg = await client.fetchOne(uid, {
                  uid: true,
                  source: true,
                  envelope: true,
                });

                if (!msg?.source) return;

                const parsed = await simpleParser(msg.source);

                const fromAddr =
                  parsed.from?.value?.[0]?.address?.toLowerCase() || "";

                const direction =
                  fromAddr === account.email.toLowerCase()
                    ? "sent"
                    : "received";

                await saveEmailToDB(
                  prisma,
                  account,
                  parsed,
                  msg,
                  direction,
                  type
                );
              } catch (e) {
                logError(account.email, `UID ${uid}: ${e.message}`);
              }
            })
          )
        );
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
  const accounts = await prisma.emailAccount.findMany({
    where: { verified: true },
  });

  const limit = pLimit(2);

  await Promise.allSettled(
    accounts.map(acc => limit(() => syncImap(prisma, acc)))
  );
}

export async function runSyncForAccount(prisma, email) {
  const acc = await prisma.emailAccount.findUnique({ where: { email } });
  if (acc) await syncImap(prisma, acc);
}
