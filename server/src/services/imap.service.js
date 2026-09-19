import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import pLimit from "p-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { resolveSecret } from "../utils/crypto.js";
import { retentionCutoff } from "../config/emailRetention.js";
import { processInboundMessage } from "./inboundProcessor.service.js";

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
  // Async append — appendFileSync blocked the event loop (and every API
  // request in the process) on each IMAP error.
  fs.promises.appendFile(ERROR_LOG_FILE, line).catch(() => {});
}

const VERBOSE = process.env.IMAP_SYNC_VERBOSE === "true";
const debug = (...args) => {
  if (VERBOSE) console.log(...args);
};

// Max messages downloaded per folder per tick. Oldest first, so a backlog
// is worked through over consecutive ticks instead of being skipped.
const MAX_PER_FOLDER = Number(process.env.IMAP_MAX_PER_FOLDER) || 300;
// Parallel account syncs. Each one holds an IMAP connection and issues DB
// writes, so keep this small.
const ACCOUNT_SYNC_CONCURRENCY = Number(process.env.IMAP_SYNC_CONCURRENCY) || 2;

/**
 * Emails sent by the campaign engine are already stored (with their body)
 * when they are sent. Their Sent-folder copies must not be downloaded and
 * stored a second time. They are recognised by the deterministic
 * Message-ID the mailer assigns: <campaign-{campaignId}-{recipientId}@…>.
 */
export function isCampaignMessageId(messageId) {
  return (
    typeof messageId === "string" &&
    /^<?campaign-\d+-\d+[@>]/i.test(messageId.trim())
  );
}

/* ======================================================
   FOLDER DETECTION
====================================================== */
function detectFolderType(name, special) {
  const n = name.toLowerCase();
  const s = (special || "").toLowerCase();
  if (n === "inbox" || n.startsWith("inbox") || s.includes("inbox"))
    return "inbox";
  if (
    n.includes("sent") ||
    n.includes("outbox") ||
    n.includes("sent items") ||
    n.includes("sent mail") ||
    s.includes("sent")
  )
    return "sent";
  if (
    n.includes("spam") ||
    n.includes("junk") ||
    n.includes("bulk") ||
    s.includes("junk")
  )
    return "spam";
  if (n.includes("trash") || n.includes("bin") || n.includes("deleted"))
    return "trash";
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
    const refs = Array.isArray(references)
      ? references
      : references.split(/\s+/);
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
   The duplicate check now happens BEFORE download (see syncFolder), so
   this only runs for messages that are genuinely new.
====================================================== */
async function saveEmailToDB(
  prisma,
  account,
  parsed,
  messageId,
  direction,
  folder,
  arrivedAt,
) {
  const accountId = Number(account.id);

  const from = parsed.from?.value?.[0];
  const fromEmail = from?.address || "";
  const fromName = from?.name || null;
  const toEmail = parsed.to?.value?.map((v) => v.address).join(", ") || "";
  const ccEmail = parsed.cc?.value?.map((v) => v.address).join(", ") || "";
  const htmlBody = parsed.html || parsed.textAsHtml || parsed.text || "";
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
    select: { id: true },
  });

  try {
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
        // createdAt = when the email ARRIVED in the mailbox — the clock the
        // retention job uses.
        createdAt: arrivedAt,
      },
      select: { id: true },
    });
  } catch (err) {
    // Same message saved concurrently (e.g. manual refresh + worker tick).
    if (err.code === "P2002") return null;
    throw err;
  }

  return { conversationId };
}

/* ======================================================
   UID STATE — uses `lastUid` field in your SyncState schema
====================================================== */
async function getLastUid(prisma, accountId, folder) {
  try {
    const state = await prisma.syncState.findFirst({
      where: { accountId: Number(accountId), folder },
      select: { lastUid: true },
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
      select: { id: true },
    });
    if (existing) {
      await prisma.syncState.update({
        where: { id: existing.id },
        data: { lastUid },
      });
    } else {
      await prisma.syncState.create({
        data: { accountId: Number(accountId), folder, lastUid },
      });
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

/**
 * Sync one folder:
 *   1. list new UIDs
 *   2. fetch ENVELOPES only (a few hundred bytes each)
 *   3. one DB query to find which Message-IDs we already have
 *   4. download + parse + save only the new ones
 *
 * Previously every message's full MIME source was downloaded and parsed
 * before checking whether it already existed — including every campaign
 * email in the Sent folder, which was then stored a second time.
 */
async function syncFolder(prisma, client, account, folderPath, type) {
  const lock = await client.getMailboxLock(folderPath);
  try {
    const mailbox = client.mailbox;
    if (!mailbox || !mailbox.exists) return;

    const lastUid = await getLastUid(prisma, account.id, type);
    let uids;

    if (lastUid === 0) {
      // First sync: only the retention window.
      uids = await client.search({ since: retentionCutoff() }, { uid: true });
      debug(
        `📅 [${account.email}] [${type}] first sync: ${uids?.length || 0} UIDs`,
      );
    } else {
      const found = await client.search(
        { uid: `${lastUid + 1}:*` },
        { uid: true },
      );
      // `n:*` always returns the highest UID even if it is <= n.
      uids = (found || []).filter((uid) => uid > lastUid);
    }

    if (!uids || uids.length === 0) return;

    uids.sort((a, b) => a - b);
    const slice = uids.slice(0, MAX_PER_FOLDER);
    const sliceMax = slice[slice.length - 1];

    // ── 2) envelopes only ────────────────────────────────────────────────
    const metas = [];
    for await (const msg of client.fetch(
      slice,
      { envelope: true, internalDate: true },
      { uid: true },
    )) {
      metas.push({
        uid: msg.uid,
        messageId: msg.envelope?.messageId || `uid-${msg.uid}`,
        internalDate: msg.internalDate,
      });
    }

    // ── 3) filter out expired, campaign copies, and already-stored ──────
    const cutoff = retentionCutoff();
    const now = new Date();
    const candidates = [];
    for (const m of metas) {
      const internal = m.internalDate ? new Date(m.internalDate) : now;
      m.arrivedAt =
        Number.isNaN(internal.getTime()) || internal > now ? now : internal;
      if (m.arrivedAt < cutoff) continue;
      if (isCampaignMessageId(m.messageId)) continue;
      candidates.push(m);
    }

    let newOnes = candidates;
    if (candidates.length) {
      const existing = await prisma.emailMessage.findMany({
        where: {
          emailAccountId: Number(account.id),
          messageId: { in: [...new Set(candidates.map((m) => m.messageId))] },
        },
        select: { messageId: true },
      });
      const have = new Set(existing.map((e) => e.messageId));
      const seen = new Set();
      newOnes = candidates.filter((m) => {
        if (have.has(m.messageId) || seen.has(m.messageId)) return false;
        seen.add(m.messageId);
        return true;
      });
    }

    // ── 4) download + save new messages, one at a time on this connection
    //       (IMAP commands are serialised per connection anyway) ─────────
    let saved = 0;
    for (const m of newOnes) {
      try {
        const msg = await client.fetchOne(
          m.uid,
          { source: true },
          { uid: true },
        );
        if (!msg?.source) continue;

        const parsed = await simpleParser(msg.source, {
          skipImageLinks: true,
          skipTextToHtml: false,
        });
        const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() || "";
        const direction =
          fromAddr === account.email.toLowerCase() ? "sent" : "received";

        const stored = await saveEmailToDB(
          prisma,
          account,
          parsed,
          m.messageId,
          direction,
          type,
          m.arrivedAt,
        );
        if (stored) {
          saved++;

          // Replies, bounces and opt-out requests (Phase 1). A failure here
          // must not lose the email itself, which is already stored.
          if (
            direction === "received" &&
            (type === "inbox" || type === "spam")
          ) {
            try {
              const outcome = await processInboundMessage({
                account,
                parsed,
                messageId: m.messageId,
                conversationId: stored.conversationId,
                receivedAt: m.arrivedAt,
                rawSource: msg.source,
              });
              if (outcome.kind === "reply" || outcome.kind === "bounce") {
                console.log(
                  `📨 [${account.email}] ${outcome.kind}: ${JSON.stringify(outcome.detail)}`,
                );
              }
            } catch (e) {
              if (isDbDown(e)) throw e;
              logError(
                account.email,
                `Inbound processing UID ${m.uid}: ${e.message}`,
              );
            }
          }
        }
      } catch (e) {
        // A DB outage must stop the whole sync (so lastUid is NOT advanced
        // past messages that were never stored).
        if (isDbDown(e)) throw e;
        logError(account.email, `UID ${m.uid}: ${e.message}`);
      }
    }

    if (sliceMax > lastUid) {
      await saveLastUid(prisma, account.id, type, sliceMax);
    }

    if (saved > 0 || uids.length > slice.length) {
      console.log(
        `📬 [${account.email}] [${type}] saved ${saved} new` +
          (uids.length > slice.length
            ? ` (${uids.length - slice.length} more next tick)`
            : ""),
      );
    }
  } finally {
    lock.release();
  }
}

function isDbDown(err) {
  const code = err?.code;
  const msg = String(err?.message || "");
  return (
    ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(code) ||
    msg.includes("Server has closed the connection") ||
    msg.includes("recovery mode") ||
    msg.includes("not yet accepting connections")
  );
}

async function syncImap(prisma, account) {
  if (activeSyncs.has(account.id)) return;
  activeSyncs.add(account.id);
  debug(`🔄 Syncing: ${account.email}`);

  let client;

  try {
    let imapPassword = null;
    try {
      imapPassword = resolveSecret(account.encryptedPass);
    } catch (err) {
      logError(account.email, `Cannot read stored password: ${err.message}`);
      return;
    }

    if (!imapPassword || !account.imapHost) {
      logError(account.email, "Missing IMAP host or password");
      return;
    }

    client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: Number(account.imapPort || 993) === 993,
      auth: { user: account.imapUser || account.email, pass: imapPassword },
      tls: { rejectUnauthorized: false },
      logger: false,
      // A hung IMAP server must never block the sync loop indefinitely.
      connectionTimeout: 30_000,
      greetingTimeout: 15_000,
      socketTimeout: 120_000,
    });

    client.on("error", (err) =>
      logError(account.email, `IMAP error: ${err.message}`),
    );
    await client.connect();

    const mailboxes = await client.list();
    const folders = [];
    const seenTypes = new Set();
    for (const box of mailboxes) {
      if (box.flags?.has?.("\\Noselect")) continue;
      const type = detectFolderType(box.path, box.specialUse);
      // One mailbox per type — lastUid is stored per type, so syncing two
      // different "sent" folders would corrupt each other's UID cursor.
      if (type && !seenTypes.has(type)) {
        seenTypes.add(type);
        folders.push({ path: box.path, type });
      }
    }

    if (!folders.length) {
      logError(account.email, "No folders detected");
      return;
    }

    for (const { path: folderPath, type } of folders) {
      await syncFolder(prisma, client, account, folderPath, type);
    }
  } catch (err) {
    if (isDbDown(err)) throw err; // let the worker's circuit breaker see it
    logError(account.email, `Sync error: ${err.message}`);
  } finally {
    activeSyncs.delete(account.id);
    if (client) await client.logout().catch(() => {});
  }
}

/* ======================================================
   PUBLIC EXPORTS
====================================================== */
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  imapHost: true,
  imapPort: true,
  imapUser: true,
  encryptedPass: true,
  userId: true, // owner — replies create CRM contacts owned by them
};

let syncRunning = false;

/**
 * Sync every verified account. Overlap-safe: if the previous run is still
 * going when the next tick fires, the new tick is skipped instead of
 * stacking a second full sync on top of the first.
 */
export async function runSync(prisma) {
  if (syncRunning) {
    debug("⏭️ IMAP sync still running — skipping this tick");
    return;
  }
  syncRunning = true;
  const t0 = Date.now();

  try {
    const accounts = await prisma.emailAccount.findMany({
      where: { verified: true, deleted: false },
      select: ACCOUNT_SELECT,
    });

    const limit = pLimit(ACCOUNT_SYNC_CONCURRENCY);
    const results = await Promise.allSettled(
      accounts.map((acc) => limit(() => syncImap(prisma, acc))),
    );

    const dbFailure = results.find(
      (r) => r.status === "rejected" && isDbDown(r.reason),
    );
    if (dbFailure) throw dbFailure.reason;

    debug(
      `✅ IMAP sync: ${accounts.length} accounts in ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  } finally {
    syncRunning = false;
  }
}

export async function runSyncForAccount(prisma, email) {
  const acc = await prisma.emailAccount.findUnique({
    where: { email },
    select: { ...ACCOUNT_SELECT, verified: true, deleted: true },
  });
  if (acc && !acc.deleted) await syncImap(prisma, acc);
}
