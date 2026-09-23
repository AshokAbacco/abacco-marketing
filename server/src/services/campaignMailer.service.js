// campaignMailer.service.js
//
// Campaign sending engine. Runs ONLY in the worker process (worker.js).
// The API process just sets Campaign.status = "sending"; the worker's
// resume tick picks it up within a few seconds.

import nodemailer from "nodemailer";
import prisma, { isDbUnavailableError } from "../prismaClient.js";
import { resolveSecret } from "../utils/crypto.js";
import { delByPrefix } from "../utils/cache.js";
import dns from "dns/promises";
import pLimit from "p-limit";
import { convert as htmlToText } from "html-to-text";
import {
  FEATURES,
  getSuppression,
  skipSuppressedRecipients,
  buildUnsubscribeParts,
} from "./suppression.service.js";
import {
  pauseAccount,
  onAccountPauseChange,
} from "./inboundProcessor.service.js";
import {
  hasMergeFields,
  renderMergeFields,
  mergeVarsFor,
} from "./automation.service.js";
import {
  getSendingDayStart,
  getAccountSentToday,
  getAccountCap,
  recordAccountSend,
  flushAccountSends,
} from "./sendingLimits.service.js";

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNT STATE MANAGEMENT (Lightweight Cooldowns)
   Replaces rigid DB pauses for temporary provider quotas.
═══════════════════════════════════════════════════════════════════════════ */
const ACCOUNT_STATES = {
  AVAILABLE: "AVAILABLE",
  COOLDOWN: "COOLDOWN",
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
  AUTH_ERROR: "AUTH_ERROR",
};

const accountStateCache = new Map(); // accountId -> { status, until, reason }

function getAccountState(accountId) {
  const state = accountStateCache.get(Number(accountId));
  if (state && state.until && Date.now() > state.until) {
    accountStateCache.delete(Number(accountId));
    return { status: ACCOUNT_STATES.AVAILABLE };
  }
  return state || { status: ACCOUNT_STATES.AVAILABLE };
}

function setAccountState(accountId, status, durationMs, reason) {
  accountStateCache.set(Number(accountId), {
    status,
    until: durationMs ? Date.now() + durationMs : null,
    reason,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — GLOBAL DAILY LIMIT HELPERS
   ─────────────────────────────────────────────────────────────────────────
   Business rules:
   • Max 5 000 emails per user per "day"
   • A "day" starts at 17:00 (5 PM) and ends at 16:59:59 the following day
   • Emails are only delivered between 17:00 → 04:59 (5 PM → 5 AM)
   • Outside that window the sender pauses and polls until 17:00 resumes
═══════════════════════════════════════════════════════════════════════════ */

export const DAILY_LIMIT = Number(process.env.DAILY_SEND_LIMIT) || 5000;

/**
 * Returns a stable Redis key for the current "day bucket".
 * The bucket starts at 17:00 local time.
 * @param {number|string} userId
 * @returns {string}
 */
export function getTodayKey(userId) {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  const bucketStart =
    now < resetToday ? new Date(resetToday.getTime() - 86_400_000) : resetToday;

  const dateLabel = bucketStart.toISOString().split("T")[0];
  return `mail_limit:${userId}:${dateLabel}`;
}

// The 5 PM → 5 PM sending window (shared with the per-mailbox caps, so
// company totals and mailbox totals always refer to the same day).
const getTodayStart = getSendingDayStart;

/* ── Daily-count cache ─────────────────────────────────────────────────────
   getDailyCount() used to run a SUM aggregate for every batch of every
   account, plus on every create/send request and every 5-second banner
   poll. The value only needs to be approximately current (the limit is
   5 000/day), so it is cached per process for a few seconds and bumped
   locally as this process records sends.                                  */
const DAILY_COUNT_TTL_MS = Number(process.env.DAILY_COUNT_TTL_MS) || 10_000;
const dailyCountCache = new Map(); // userId → { bucket, count, at }
const dailyCountInflight = new Map();

/**
 * How many emails this user has sent in the current 5 PM → 5 PM bucket.
 * @param {string} userId
 * @param {{ fresh?: boolean }} [opts]  fresh=true bypasses the cache
 * @returns {Promise<number>}
 */
export async function getDailyCount(userId, { fresh = false } = {}) {
  const start = getTodayStart();
  const bucket = start.getTime();
  const cached = dailyCountCache.get(userId);

  if (
    !fresh &&
    cached &&
    cached.bucket === bucket &&
    Date.now() - cached.at < DAILY_COUNT_TTL_MS
  ) {
    return cached.count;
  }

  const key = `${userId}|${bucket}`;
  if (dailyCountInflight.has(key)) return dailyCountInflight.get(key);

  const p = (async () => {
    try {
      const result = await prisma.dailyEmailLog.aggregate({
        _sum: { count: true },
        where: { userId, sentAt: { gte: start } },
      });
      // Include sends buffered in this process but not flushed yet.
      const count = (result._sum.count || 0) + pendingDailyFor(userId, bucket);
      dailyCountCache.set(userId, { bucket, count, at: Date.now() });
      return count;
    } finally {
      dailyCountInflight.delete(key);
    }
  })();

  dailyCountInflight.set(key, p);
  return p;
}

/* ── Buffered DailyEmailLog writes ─────────────────────────────────────────
   Every successful send used to UPSERT the same (userId, bucket) row. With
   many accounts sending for one user, that single row was the most
   contended row in the database. Sends are now counted in memory and
   flushed as ONE upsert per user every few seconds (and on shutdown).    */
const DAILY_FLUSH_MS = Number(process.env.DAILY_LOG_FLUSH_MS) || 5_000;
const dailyBuffer = new Map(); // `${userId}|${bucketMs}` → { userId, bucketStart, userName, empId, count }
let dailyFlushTimer = null;
let dailyFlushing = null;

function pendingDailyFor(userId, bucket) {
  const entry = dailyBuffer.get(`${userId}|${bucket}`);
  return entry ? entry.count : 0;
}

function recordDailySend(campaign) {
  const bucketStart = getTodayStart();
  const bucket = bucketStart.getTime();
  const key = `${campaign.userId}|${bucket}`;

  const entry = dailyBuffer.get(key) || {
    userId: campaign.userId,
    bucketStart,
    userName: campaign.user?.name || "Unknown",
    empId: campaign.user?.empId || "N/A",
    count: 0,
  };
  entry.count += 1;
  dailyBuffer.set(key, entry);

  const cached = dailyCountCache.get(campaign.userId);
  if (cached && cached.bucket === bucket) cached.count += 1;

  if (!dailyFlushTimer) {
    dailyFlushTimer = setTimeout(() => {
      dailyFlushTimer = null;
      flushDailyLog().catch((err) =>
        console.error("⚠️ Daily log flush failed (will retry):", err.message),
      );
    }, DAILY_FLUSH_MS);
    dailyFlushTimer.unref?.();
  }
}

/**
 * Write buffered send counts to DailyEmailLog. Safe to call any time;
 * failed entries are put back into the buffer and retried on the next flush.
 * Exported so worker.js can flush on shutdown.
 */
export async function flushDailyLog() {
  if (dailyFlushing) return dailyFlushing;
  if (dailyBuffer.size === 0) return;

  const entries = [...dailyBuffer.values()];
  dailyBuffer.clear();

  dailyFlushing = (async () => {
    for (const e of entries) {
      try {
        await prisma.dailyEmailLog.upsert({
          where: { userId_sentAt: { userId: e.userId, sentAt: e.bucketStart } },
          update: { count: { increment: e.count } },
          create: {
            userId: e.userId,
            userName: e.userName,
            empId: e.empId,
            count: e.count,
            sentAt: e.bucketStart,
          },
          select: { id: true },
        });
      } catch (err) {
        // Put it back so the count isn't lost.
        const key = `${e.userId}|${e.bucketStart.getTime()}`;
        const cur = dailyBuffer.get(key);
        if (cur) cur.count += e.count;
        else dailyBuffer.set(key, e);
        if (!dailyFlushTimer) {
          dailyFlushTimer = setTimeout(() => {
            dailyFlushTimer = null;
            flushDailyLog().catch(() => {});
          }, DAILY_FLUSH_MS * 2);
          dailyFlushTimer.unref?.();
        }
        throw err;
      }
    }
  })();

  try {
    await dailyFlushing;
  } finally {
    dailyFlushing = null;
  }
}

/**
 * Returns milliseconds until the next 17:00 (5 PM) reset.
 * @returns {number}
 */
export function msUntilNextWindow() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const next = new Date(now);
  next.setHours(17, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — UTILITY HELPERS
═══════════════════════════════════════════════════════════════════════════ */

// DNS lookups were repeated for every follow-up email. Cache per host.
const smtpIpCache = new Map(); // host → { ip, at }
const SMTP_IP_TTL_MS = 10 * 60 * 1000;

async function getSmtpIp(host) {
  if (!host) return "unknown";
  const hit = smtpIpCache.get(host);
  if (hit && Date.now() - hit.at < SMTP_IP_TTL_MS) return hit.ip;
  let ip = "unknown";
  try {
    ip = (await dns.lookup(host)).address;
  } catch {
    /* keep "unknown" */
  }
  smtpIpCache.set(host, { ip, at: Date.now() });
  return ip;
}

/**
 * Deterministic RFC 5322 Message-ID for a campaign recipient.
 *   • Lets the IMAP sync recognise (and skip) the Sent-folder copy of a
 *     campaign email instead of downloading and storing it a second time.
 *   • Gives follow-ups a real In-Reply-To target so mail clients thread them.
 *   • Keeps EmailMessage.upsert idempotent across retries.
 */
function buildCampaignMessageId(campaignId, recipientId, fromEmail) {
  const domain =
    String(fromEmail || "")
      .split("@")[1]
      ?.toLowerCase() || "abacco.local";
  return `<campaign-${campaignId}-${recipientId}@${domain}>`;
}

const CAMPAIGN_HEADER = "X-Abacco-Campaign";

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function distribute(items, total) {
  const result = [];
  let index = 0;
  for (let i = 0; i < total; i++) {
    result.push(items[index % items.length]);
    index++;
  }
  return shuffle(result);
}

function buildFollowupHtml({
  followUpBody,
  originalBody,
  from,
  to,
  sentAt,
  subject,
  baseColor,
}) {
  return `
<div style="font-family: Calibri, sans-serif;">
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <div style="font-size:14px; line-height:1.5; color:#000000;">
        <b>From:</b> ${from}<br/>
        <b>Sent:</b> ${sentAt}<br/>
        <b>To:</b> ${to}<br/>
        <b>Subject:</b> ${subject}
      </div>

      <br />

      <div style="margin:0; padding-left:10px; border-left:3px solid #cccccc; color:#000000; font-family:Calibri,sans-serif; font-size:14px; line-height:1.6;">
        ${originalBody || ""}
      </div>

    </div>
  `;
}

function buildSignature(account, senderRole, baseStyles = {}) {
  const name = account.senderName || account.email?.split("@")[0] || "Sender";

  const role = senderRole?.trim() || "Marketing Analyst";
  const sigColor = baseStyles.color || "#000000";
  const sigFont = baseStyles.fontFamily || "Calibri, sans-serif";
  const sigSize = baseStyles.fontSize || "16px";

  return `
    <div style="margin-top:16px; font-family:${sigFont}; font-size:${sigSize}; line-height:1.6; color:${sigColor};">
      <span style="color:${sigColor}; font-weight:bold;">Regards,</span>
      <br/>
      <span style="color:${sigColor}; font-weight:bold;">${name} - ${role}</span>
    </div>
  `;
}

function extractBodyContent(fullHtml) {
  if (!fullHtml) return "";

  try {
    let html = fullHtml
      .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;

    const wrapperRegex =
      /<div[^>]+style\s*=\s*["'][^"']*font-family[^"']*["'][^>]*>/i;
    const wrapperMatch = bodyContent.match(wrapperRegex);

    if (wrapperMatch) {
      const openTag = wrapperMatch[0];
      const startIdx = bodyContent.indexOf(openTag);
      const innerStart = startIdx + openTag.length;

      let depth = 1;
      let pos = innerStart;
      while (pos < bodyContent.length && depth > 0) {
        const nextOpen = bodyContent.indexOf("<div", pos);
        const nextClose = bodyContent.indexOf("</div>", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            const inner = bodyContent.substring(innerStart, nextClose).trim();
            return inner || bodyContent.substring(innerStart, nextClose).trim();
          }
          pos = nextClose + 6;
        }
      }
    }

    return bodyContent.trim();
  } catch (err) {
    console.error("extractBodyContent error:", err.message);
    try {
      return fullHtml
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    } catch {
      return "";
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const SAFE_LIMITS = {
  gmail: 50,
  gsuite: 80,
  rediff: 40,
  amazon: 60,
  custom: 60,
};

function getLimit(provider = "", accountId = null, customLimits = {}) {
  if (accountId && customLimits[accountId]) {
    return customLimits[accountId];
  }
  const key = provider.toLowerCase();
  return SAFE_LIMITS[key] || SAFE_LIMITS.custom;
}

function getDomainLabel(email = "") {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain.includes("gmail")) return "gmail";
  if (domain.includes("yahoo")) return "yahoo";
  if (domain.includes("outlook") || domain.includes("hotmail"))
    return "outlook";
  return domain.split(".")[0] || "client";
}

function normalizeHtmlForEmail(html) {
  if (!html) return html;

  let cleaned = html.trim();

  cleaned = cleaned.replace(/font-size:\s*(\d+)pt/gi, (match, size) => {
    const pxSize = Math.round(parseFloat(size) * 1.333);
    return `font-size:${pxSize}px`;
  });

  cleaned = cleaned.replace(/<font([^>]*)>/gi, (match, attributes) => {
    const colorMatch = attributes.match(/color="([^"]*)"/i);
    const color = colorMatch ? `color:${colorMatch[1]};` : "";
    const otherAttrs = attributes.replace(/color="([^"]*)"/gi, "");
    return `<span style="${color}${otherAttrs}">`;
  });
  cleaned = cleaned.replace(/<\/font>/gi, "</span>");

  cleaned = cleaned.replace(/<div>\s*<\/div>/gi, "");
  cleaned = cleaned.replace(/<div><br><\/div>/gi, "<br>");
  cleaned = cleaned.replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");

  cleaned = cleaned.replace(
    /<p([^>]*)>/gi,
    '<p$1 style="margin:0; padding:0; mso-margin-top-alt:0; mso-margin-bottom-alt:0; line-height:1.4;">',
  );

  return cleaned;
}

function extractBaseStyles(html) {
  const fontFamilyMatch = html.match(/font-family:\s*([^;}"']+)/i);
  const fontSizeMatch = html.match(/font-size:\s*([^;}"']+)/i);

  const UNSAFE = new Set([
    "#fff",
    "#ffffff",
    "white",
    "transparent",
    "inherit",
    "",
  ]);
  let color = "#000000";

  const wrapperDivMatch = html.match(/^\s*<div[^>]*style="([^"]*)"/i);
  if (wrapperDivMatch) {
    const styleStr = wrapperDivMatch[1];
    const colorInDiv = styleStr.match(/\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (colorInDiv) {
      const c = colorInDiv[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  if (color === "#000000") {
    const fontTagColor = html.match(/<font[^>]*\bcolor="(#[0-9a-fA-F]{3,6})"/i);
    if (fontTagColor) {
      const c = fontTagColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  if (color === "#000000") {
    const spanColor = html.match(
      /<span[^>]*style="[^"]*\bcolor:\s*(#[0-9a-fA-F]{3,6})/i,
    );
    if (spanColor) {
      const c = spanColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  return {
    fontFamily: fontFamilyMatch
      ? fontFamilyMatch[1].trim()
      : "Calibri, sans-serif",
    fontSize: fontSizeMatch ? fontSizeMatch[1].trim() : "15px",
    color,
  };
}

const MAX_BATCH_SIZE = 10;
// Claim only as many rows as will be sent within about this window. Rows
// sit in "processing" until they are sent, and worker.js's recovery sweep
// resets rows that have been "processing" for 3 minutes — so a batch must
// never wait longer than that. At 180 s/email this claims 1 row at a time.
const CLAIM_WINDOW_MS = 60_000;
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL CONCURRENCY CAP

   One module-level limiter shared by every account of every campaign in
   this process. A slot is held ONLY while doing database/SMTP work:

     • claiming the next batch         (a few queries)
     • sending ONE email + its writes  (one SMTP call + ~3 queries)

   The pacing sleep between emails (up to several minutes per email at
   safe Gmail rates) happens OUTSIDE the slot. Previously the sleep ran
   inside the slot, so 6 slots × 10 emails × 180 s meant every other
   account sat idle for up to 30 minutes waiting for a turn.

   Tune with ACCOUNT_CONCURRENCY. Each slot uses at most one DB connection
   at a time, so keep it ≤ PRISMA_POOL_SIZE - 2.
═══════════════════════════════════════════════════════════════════════════ */
const ACCOUNT_CONCURRENCY = Number(process.env.ACCOUNT_CONCURRENCY) || 4;
const globalAccountLimit = pLimit(ACCOUNT_CONCURRENCY);
if (process.env.PROCESS_ROLE === "worker") {
  console.log(`🎛️  Global send concurrency cap: ${ACCOUNT_CONCURRENCY}`);
}

function createTransporter(account, smtpPassword) {
  const domain = (account.email.split("@")[1] || "localhost").toLowerCase();
  const port = Number(account.smtpPort);
  return nodemailer.createTransport({
    host: account.smtpHost,
    port,
    secure: port === 465,
    name: domain,
    pool: true,
    // One connection per account: emails from one account are sent strictly
    // one after another with a pacing delay in between.
    maxConnections: 1,
    maxMessages: 50,
    auth: {
      user: account.smtpUser || account.email,
      pass: smtpPassword,
    },
    requireTLS: port === 587,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    },
  });
}

/**
 * Per-account-loop cache of SMTP transporters and account rows.
 * Follow-ups can send from the ORIGINAL sender account (not the one the
 * row is assigned to); previously every follow-up email loaded that
 * account from the DB and opened a brand-new pooled transporter that was
 * never closed — leaking one SMTP connection per email.
 */
function createSenderCache() {
  const accounts = new Map(); // accountId → account row
  const transporters = new Map(); // accountId → transporter

  return {
    seed(account, transporter) {
      accounts.set(account.id, account);
      transporters.set(account.id, transporter);
    },
    async get(accountId) {
      const id = Number(accountId);
      let account = accounts.get(id);
      if (account === undefined) {
        account = await prisma.emailAccount.findUnique({ where: { id } });
        accounts.set(id, account || null);
      }
      if (!account || !account.smtpHost) return null;

      let transporter = transporters.get(id);
      if (!transporter) {
        transporter = createTransporter(account, decryptPassword(account));
        transporters.set(id, transporter);
      }
      return {
        account,
        transporter,
        fromEmail: account.smtpUser || account.email,
      };
    },
    closeAll() {
      for (const t of transporters.values()) {
        try {
          t.close();
        } catch {
          /* already closed */
        }
      }
      transporters.clear();
      accounts.clear();
    },
  };
}

function decryptPassword(account) {
  return resolveSecret(account.encryptedPass);
}

export async function resolveOriginalCampaignId(startId) {
  let currentId = startId;
  const MAX_LEVELS = 10;

  for (let level = 0; level < MAX_LEVELS; level++) {
    const ancestor = await prisma.campaign.findUnique({
      where: { id: currentId },
      select: { id: true, sendType: true, parentCampaignId: true },
    });

    if (!ancestor) break;
    if (ancestor.sendType !== "followup" || !ancestor.parentCampaignId) break;

    currentId = ancestor.parentCampaignId;
  }

  return currentId;
}

function buildNormalEmailHtml(body, signature, baseStyles, footerHtml = "") {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    body { margin:0; padding:0; }
    table { border-collapse: collapse; }
    p { margin:0 !important; padding:0 !important; line-height:1.6 !important; }
    div { margin:0; padding:0; }
    .ExternalClass p { margin:0 !important; }
  </style>
  <!--[if mso]>
  <style>
    p { margin:0 !important; line-height:1.6 !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#ffffff;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
    style="border-collapse:collapse; background-color:#ffffff;">
    <tr>
      <td style="padding-top:15px; background-color:#ffffff;">
        <div style="
          font-family:${baseStyles.fontFamily};
          font-size:${baseStyles.fontSize};
          color:${baseStyles.color};
          line-height:1.4;
          mso-line-height-rule:exactly;
        ">
          ${body}
          ${signature}
          ${footerHtml}
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — RETRY / ERROR HELPERS
═══════════════════════════════════════════════════════════════════════════ */

// Max number of times a single recipient may be bounced back to "pending"
// after a temporary/unclassified error before we give up and mark it failed.
// Exported so server.js's stuck-email recovery job uses the same budget
// instead of a separate, inconsistent cap on the same retryCount field.
export const MAX_TRANSIENT_RETRIES = 5;

/**
 * Permanent (non-retryable) failures: invalid/nonexistent recipients, hard
 * bounces, and auth/config problems. These should be marked "failed"
 * immediately — retrying them just wastes time and SMTP connections.
 */
function isPermanentError(err) {
  const msg = (err.message || "").toLowerCase();
  const code = err.responseCode || err.code;

  // Any SMTP 5xx reply is a hard bounce / permanent rejection by definition.
  if (typeof code === "number" && code >= 500 && code < 600) return true;

  return (
    /\b55[0-9]\b/.test(msg) || // 550, 551, 553, 554...
    msg.includes("no such user") ||
    msg.includes("user unknown") ||
    msg.includes("user not found") ||
    msg.includes("mailbox not found") ||
    msg.includes("mailbox unavailable") ||
    msg.includes("recipient address rejected") ||
    msg.includes("address rejected") ||
    msg.includes("recipient rejected") ||
    msg.includes("does not exist") ||
    msg.includes("invalid recipient") ||
    msg.includes("invalid mailbox") ||
    msg.includes("no mailbox") ||
    msg.includes("relay access denied") ||
    msg.includes("authentication failed") ||
    msg.includes("invalid login") ||
    msg.includes("invalid credentials") ||
    msg.includes("bad credentials") ||
    msg.includes("eauth") ||
    msg.includes("invalid address") ||
    msg.includes("daily user sending limit exceeded")
  );
}

/**
 * Temporary / transient failures: worth retrying (timeouts, rate limiting,
 * dropped connections, SMTP 4xx soft bounces). Anything that is neither
 * clearly permanent nor clearly temporary is treated as temporary by default
 * — an unrecognized error is far more likely to be a transient blip than an
 * invalid address, and MAX_TRANSIENT_RETRIES keeps it from retrying forever.
 */
function isTemporaryError(err) {
  if (isPermanentError(err)) return false;

  const msg = (err.message || "").toLowerCase();
  const code = err.responseCode || err.code;

  if (typeof code === "number" && code >= 400 && code < 500) return true;

  // Recognized transient patterns (kept mainly for logging/clarity — see
  // the docstring above: anything NOT matched by isPermanentError already
  // falls through to `true` below, since an unrecognized error is far more
  // likely to be a transient blip than a bad address).
  void msg; // msg still useful if extending the pattern list below
  return true;
}

/**
 * Sends via sendFn, retrying transient failures with exponential backoff.
 * Each attempt gets its own timeout (rather than one timeout wrapped around
 * every retry), so a slow attempt doesn't eat the whole retry budget.
 * Permanent errors (bad recipient, auth failure, etc.) fail fast — no point
 * retrying those.
 */
/**
 * The PROVIDER refused because this ACCOUNT hit a sending limit (e.g. Gmail
 * "550 5.4.5 Daily user sending quota exceeded"). The recipient is fine —
 * the account must rest. Checked before isPermanentError(), which would
 * otherwise fail every remaining recipient with a 5xx.
 */
const QUOTA_RE =
  /(5\.4\.5|sending (quota|limit)|user sending quota|daily (user )?sending|too many (messages|emails|recipients)|message rate limit|rate[- ]limit(ed)?|4\.7\.28|exceeded (the )?(daily|hourly|sending) (limit|quota))/i;

export function isQuotaError(err) {
  const text = `${err?.response || ""} ${err?.message || ""}`;
  return QUOTA_RE.test(text);
}

/** The account's own login/config is broken — no recipient can succeed. */
export function isAccountAuthError(err) {
  const text =
    `${err?.code || ""} ${err?.response || ""} ${err?.message || ""}`.toLowerCase();
  return (
    err?.code === "EAUTH" ||
    /\b(eauth|authentication failed|invalid login|invalid credentials|bad credentials|username and password not accepted|application-specific password required|535[ -]5\.7\.8)\b/.test(
      text,
    ) ||
    text.includes("stored password uses the v2 format")
  );
}

const QUOTA_PAUSE_HOURS = Number(process.env.QUOTA_PAUSE_HOURS) || 24;
// How often a loop waiting on a paused account re-checks it.
const PAUSED_RECHECK_MS =
  Number(process.env.PAUSED_ACCOUNT_RECHECK_MS) || 60_000;
// How often a mailbox that hit its daily cap re-checks (in case an admin
// raises the cap before the window resets).
const CAP_RECHECK_MS = Number(process.env.CAP_RECHECK_MS) || 15 * 60_000;

/* ── Account pause cache ──────────────────────────────────────────────── */
const PAUSE_TTL_MS = Number(process.env.ACCOUNT_PAUSE_CACHE_MS) || 15_000;
const pauseCache = new Map(); // accountId → { paused, reason, at }
onAccountPauseChange((accountId) => {
  if (accountId === null || accountId === undefined) pauseCache.clear();
  else pauseCache.delete(Number(accountId));
});

async function getAccountPause(accountId) {
  const hit = pauseCache.get(accountId);
  if (hit && Date.now() - hit.at < PAUSE_TTL_MS) return hit;
  const row = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: {
      sendingPausedAt: true,
      sendingPausedReason: true,
      sendingPausedUntil: true,
    },
  });
  const expired =
    row?.sendingPausedUntil && row.sendingPausedUntil <= new Date();
  const value = {
    paused: Boolean(row?.sendingPausedAt) && !expired,
    reason: row?.sendingPausedReason || null,
    at: Date.now(),
  };
  pauseCache.set(accountId, value);
  return value;
}

async function pauseForAccountError(accountId, err) {
  const detail = String(err?.response || err?.message || "").slice(0, 160);
  if (isAccountAuthError(err)) {
    // No automatic resume: the password has to be fixed first.
    await pauseAccount(accountId, `Login failed: ${detail}`, 0).catch(() => {});
  } else {
    await pauseAccount(
      accountId,
      `Provider sending limit: ${detail}`,
      QUOTA_PAUSE_HOURS,
    ).catch(() => {});
  }
  pauseCache.set(accountId, {
    paused: true,
    reason: "account",
    at: Date.now(),
  });
}

/** Plain-text alternative part (improves deliverability). */
function toPlainText(html) {
  if (!FEATURES.textAlternative) return undefined;
  try {
    return htmlToText(html, {
      wordwrap: 100,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      ],
    });
  } catch {
    return undefined;
  }
}

async function sendWithRetry(
  sendFn,
  { retries = 3, attemptTimeoutMs = 20000, transporter = null } = {},
) {
  let lastError;

  for (let i = 1; i <= retries; i++) {
    let timer;
    let timedOut = false;

    try {
      const sendPromise = Promise.resolve().then(() => sendFn());

      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;

          const timeoutError = new Error(
            `SMTP attempt timed out after ${attemptTimeoutMs}ms`,
          );

          timeoutError.code = "ETIMEDOUT";
          timeoutError.smtpTimeout = true;

          reject(timeoutError);
        }, attemptTimeoutMs);
      });

      return await Promise.race([sendPromise, timeoutPromise]);
    } catch (err) {
      lastError = err;

      console.warn(`⚠️ SMTP attempt ${i}/${retries} failed: ${err.message}`);

      /*
       * If the timeout won the race, sendMail() itself may still be
       * running in the background because Promise.race() cannot cancel
       * an already-running promise.
       *
       * Do not immediately start another SMTP attempt on the same
       * potentially stuck pooled connection.
       */
      if (timedOut) {
        console.error(
          `⏱️ SMTP attempt ${i}/${retries} timed out — ` +
            `connection may still be busy`,
        );

        /*
         * If a transporter was supplied, close its pooled SMTP
         * connections so a new connection can be established for
         * the next attempt.
         */
        if (transporter) {
          try {
            transporter.close();
          } catch (closeErr) {
            console.warn(
              `⚠️ Failed to close SMTP transporter after timeout: ` +
                `${closeErr.message}`,
            );
          }
        }
      }

      /*
       * These errors should not be retried because they indicate an
       * account/quota/permanent recipient problem.
       */
      if (
        isQuotaError(err) ||
        isAccountAuthError(err) ||
        isPermanentError(err)
      ) {
        throw err;
      }

      /*
       * No more attempts.
       */
      if (i >= retries) {
        break;
      }

      /*
       * Exponential backoff:
       * attempt 1 → 2s
       * attempt 2 → 4s
       * attempt 3 → stop
       */
      const backoff = Math.min(2000 * 2 ** (i - 1), 15000);

      console.log(
        `🔄 SMTP retry ${i + 1}/${retries} in ` +
          `${Math.ceil(backoff / 1000)}s`,
      );

      await sleep(backoff);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  throw lastError;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — PER-ACCOUNT SEND LOOP

   For each account:
     loop
       [slot] check campaign status + daily limit, count pending,
              atomically CLAIM the next few rows (pending → processing)
       for each claimed row
         [slot] heartbeat → send one email → mark sent/failed
         sleep pacing delay (outside the slot)
═══════════════════════════════════════════════════════════════════════════ */

const CAMPAIGN_VERBOSE = process.env.CAMPAIGN_VERBOSE === "true";

// function getControlledDelay({ limit, remainingEmails, estimatedCompletion }) {
//   // Base delay from the provider's hourly limit (strict ceiling on speed).
//   const baseDelay = (60 * 60 * 1000) / Math.max(limit, 1);

//   // Speed up (never beyond the hourly limit) if behind schedule.
//   if (estimatedCompletion) {
//     const remainingTimeMs =
//       new Date(estimatedCompletion).getTime() - Date.now();
//     if (remainingTimeMs > 0 && remainingEmails > 0) {
//       const requiredDelay = remainingTimeMs / remainingEmails;
//       return Math.max(200, Math.min(baseDelay, requiredDelay));
//     }
//   }
//   return baseDelay;
// }

function getControlledDelay({ limit }) {
  // Strict pacing from the per-account hourly limit set in the UI.
  // Never speed up to "catch up" to estimatedCompletion — that is only
  // an estimate for display; the /hr limit is what protects the mailbox.
  const perHour = Math.max(Number(limit) || 1, 1);
  return (60 * 60 * 1000) / perHour;
}
function claimSizeFor(delayMs) {
  return Math.max(
    1,
    Math.min(
      MAX_BATCH_SIZE,
      Math.floor(CLAIM_WINDOW_MS / Math.max(delayMs, 1)),
    ),
  );
}

/* ── Campaign status cache ────────────────────────────────────────────────
   Every account of a campaign checks "is this campaign still sending?".
   One cached lookup per campaign every few seconds is plenty — a Stop
   click is honoured within STATUS_TTL_MS.                                */
const STATUS_TTL_MS = 3_000;
const statusCache = new Map(); // campaignId → { status, at }

async function getCampaignStatus(campaignId) {
  const hit = statusCache.get(campaignId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const row = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  const status = row?.status ?? null;
  statusCache.set(campaignId, { status, at: Date.now() });
  return status;
}

/**
 * Claim the next rows for one account. Runs inside a global slot.
 * Determines shared-queue access based on campaign type.
 */
async function claimNextBatch({ campaignId, accountId, userId, ctx }) {
  const { account, campaign } = ctx;
  const isFollowup = campaign.sendType === "followup";

  // [1] Campaign still sending?
  let status;
  try {
    status = await getCampaignStatus(campaignId);
  } catch (err) {
    return { action: "wait", ms: 5000 };
  }

  if (status !== "sending") {
    return { action: "stop" };
  }

  // [2] Check actually pending recipients FIRST
  let remaining = 0;
  try {
    if (isFollowup) {
      const res = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS count FROM "CampaignRecipient" 
        WHERE "campaignId" = ${campaignId} AND "accountId" = ${accountId} AND "status" = 'pending'
      `;
      remaining = res[0]?.count || 0;
    } else {
      const res = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS count FROM "CampaignRecipient" 
        WHERE "campaignId" = ${campaignId} AND "status" = 'pending'
      `;
      remaining = res[0]?.count || 0;
    }
  } catch (err) {
    return { action: "wait", ms: 5000 };
  }

  // [3] If zero remaining, stop this processor cleanly.
  if (remaining === 0) {
    return { action: "done" };
  }

  // [4] Check sender/account runtime availability
  const state = getAccountState(accountId);
  if (
    state.status === ACCOUNT_STATES.QUOTA_EXHAUSTED ||
    state.status === ACCOUNT_STATES.AUTH_ERROR
  ) {
    if (!ctx.stateLogged) {
      console.warn(
        `⏸️ [${account.email}] state is ${state.status} (${state.reason || "N/A"}) — stopping processor. Queue is released.`,
      );
      ctx.stateLogged = true;
    }
    return { action: "stop" };
  }
  if (state.status === ACCOUNT_STATES.COOLDOWN) {
    return { action: "wait", ms: Math.max(5000, state.until - Date.now()) };
  }
  ctx.stateLogged = false;

  // Fallback to manual DB pause checks
  try {
    const pause = await getAccountPause(accountId);
    if (pause.paused) {
      if (!ctx.pauseLogged) {
        console.warn(
          `⏸️ [${account.email}] is manually paused — stopping processor.`,
        );
        ctx.pauseLogged = true;
      }
      return { action: "stop" };
    }
    ctx.pauseLogged = false;
  } catch (err) {
    return { action: "wait", ms: 5000 };
  }

  // [5] Global daily limit
  let dailyCount;
  try {
    dailyCount = await getDailyCount(userId);
  } catch (err) {
    return { action: "wait", ms: 5000 };
  }

  if (dailyCount >= DAILY_LIMIT) {
    const waitMs = msUntilNextWindow();
    console.log(
      `🚫 Daily limit reached for user ${userId}. Stopping ${account.email} until next window.`,
    );
    return { action: "stop" };
  }

  // [6] This mailbox's own daily cap
  let capRoom = Infinity;
  try {
    const [{ cap, source, warmupDay }, sentToday] = await Promise.all([
      getAccountCap(accountId),
      getAccountSentToday(accountId),
    ]);
    capRoom = cap - sentToday;

    if (capRoom <= 0) {
      if (!ctx.capLogged) {
        console.log(
          `📵 ${account.email} reached daily cap (${sentToday}/${cap}). Stopping processor.`,
        );
        ctx.capLogged = true;
      }
      return { action: "stop" }; // Exit processor so campaign isn't held hostage
    }
    ctx.capLogged = false;
  } catch (err) {
    return { action: "wait", ms: 5000 };
  }

  ctx.delayPerEmail = getControlledDelay({ limit: ctx.limit });
  try {
    const [row] = await prisma.$queryRaw`
      SELECT MAX("sentAt") AS last
      FROM "CampaignRecipient"
      WHERE "accountId" = ${accountId} AND "sentAt" IS NOT NULL
    `;
    if (row?.last) {
      const waitMs =
        new Date(row.last).getTime() + ctx.delayPerEmail - Date.now();
      if (waitMs > 1000) {
        return { action: "wait", ms: Math.min(waitMs, 60_000) };
      }
    }
  } catch (err) {
    return { action: "wait", ms: 5000 };
  }

  // [7] Atomic claim (Dynamic reassignment for normal campaigns)
  try {
    const take = Math.max(
      1,
      Math.min(claimSizeFor(ctx.delayPerEmail), capRoom),
    );

    const claimed = isFollowup
      ? await prisma.$queryRaw`
          UPDATE "CampaignRecipient"
          SET "status" = 'processing', "updatedAt" = NOW()
          WHERE "id" IN (
            SELECT "id" FROM "CampaignRecipient"
            WHERE "campaignId" = ${campaignId} 
              AND "accountId" = ${accountId} 
              AND "status" = 'pending'
            ORDER BY "id" LIMIT ${take}
            FOR UPDATE SKIP LOCKED
          ) RETURNING "id", "email", "retryCount"
        `
      : await prisma.$queryRaw`
          UPDATE "CampaignRecipient"
          SET "status" = 'processing', "updatedAt" = NOW(), "accountId" = ${accountId}
          WHERE "id" IN (
            SELECT "id" FROM "CampaignRecipient"
            WHERE "campaignId" = ${campaignId} 
              AND "status" = 'pending'
            ORDER BY "id" LIMIT ${take}
            FOR UPDATE SKIP LOCKED
          ) RETURNING "id", "email", "retryCount"
        `;

    if (claimed.length === 0) {
      return { action: "wait", ms: 2000 };
    }

    claimed.sort((a, b) => a.id - b.id);

    if (CAMPAIGN_VERBOSE || take > 1) {
      console.log(
        `[${account.email}] remaining=${remaining} ` +
          `delay=${(ctx.delayPerEmail / 1000).toFixed(1)}s ` +
          `claimed=${claimed.length}`,
      );
    }

    return { action: "send", batch: claimed };
  } catch (err) {
    console.error(`⚠️ [${account.email}] claim failed: ${err.message}`);
    return { action: "wait", ms: 5000 };
  }
}

/** Retry a critical status write so a DB blip can't cause a re-send. */
async function writeWithRetry(fn, label, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isDbUnavailableError(err)) throw err;
      await sleep(Math.min(1000 * 2 ** i, 15_000));
    }
  }
  console.error(
    `❌ ${label} failed after ${attempts} attempts:`,
    lastErr?.message,
  );
  throw lastErr;
}

/**
 * Send one claimed row. Runs inside a global slot.
 * @returns {Promise<{ outcome: "sent"|"failed"|"retry"|"skipped"|"stop"|"account_error", retryDelayMs?: number }>}
 */
async function processRecipient(recipient, ctx) {
  const { campaign } = ctx;

  // Stop honoured between emails, not only between batches.
  // Unsent rows go back to "pending" so Resume can pick them up.
  let status;

  try {
    status = await getCampaignStatus(campaign.id);
  } catch {
    // Transient DB problem. Keep processing state for now; the recovery
    // sweep can safely return the row to pending if necessary.
    status = "sending";
  }

  if (status !== "sending") {
    await prisma.campaignRecipient
      .updateMany({
        where: {
          id: recipient.id,
          status: "processing",
        },
        data: {
          status: "pending",
          updatedAt: new Date(),
        },
      })
      .catch(() => {});

    return { outcome: "stop" };
  }

  /*
   * HEARTBEAT + OWNERSHIP CHECK
   *
   * If the recovery worker already changed this row from "processing"
   * back to "pending", this processor no longer owns it.
   *
   * Do not send it again.
   */
  let own;

  try {
    own = await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        status: "processing",
      },
      data: {
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(
      `⚠️ [${ctx.account.email}] heartbeat failed for ` +
        `${recipient.email}: ${err.message}`,
    );

    // Leave the row as processing. The recovery sweep will handle it.
    throw err;
  }

  if (own.count === 0) {
    return { outcome: "skipped" };
  }

  const assignment = ctx.assign(recipient.id);

  /*
   * INVALID EMAIL
   *
   * This is a recipient problem, not an SMTP/account problem.
   */
  if (!EMAIL_FORMAT_RE.test(recipient.email || "")) {
    await prisma.campaignRecipient
      .update({
        where: {
          id: recipient.id,
        },
        data: {
          status: "failed",
          error: "Invalid email address format",
          updatedAt: new Date(),
        },
      })
      .catch(() => {});

    return { outcome: "failed" };
  }

  /*
   * SUPPRESSION / DO-NOT-CONTACT CHECK
   */
  const suppression = await getSuppression(recipient.email);

  if (suppression.suppressed) {
    await markSkipped(recipient.id, `Suppressed: ${suppression.reason}`);

    return { outcome: "suppressed" };
  }

  try {
    const sent =
      campaign.sendType === "followup"
        ? await sendOneFollowup({
            recipient,
            ctx,
            assignment,
          })
        : await sendOneNormal({
            recipient,
            ctx,
            assignment,
          });

    if (sent === "skipped") {
      return { outcome: "suppressed" };
    }

    return {
      outcome: sent ? "sent" : "failed",
    };
  } catch (err) {
    /*
     * IMPORTANT:
     *
     * SMTP may have accepted the message but the subsequent DB update
     * may have failed. Never retry a message when the send operation
     * explicitly tells us that it was already accepted.
     */
    if (err?.alreadySent) {
      return { outcome: "sent" };
    }

    /*
     * ACCOUNT-LEVEL FAILURE
     * The recipient itself is NOT failed. Put it back into pending.
     */
    if (err?.accountPaused || isQuotaError(err) || isAccountAuthError(err)) {
      const targetAccountId = err?.accountId || ctx.account.id;

      if (isAccountAuthError(err)) {
        setAccountState(
          targetAccountId,
          ACCOUNT_STATES.AUTH_ERROR,
          null,
          err.message,
        );
        await pauseForAccountError(targetAccountId, err).catch(() => {}); // Keep DB pause for Auth UI visibility
      } else if (isQuotaError(err)) {
        setAccountState(
          targetAccountId,
          ACCOUNT_STATES.QUOTA_EXHAUSTED,
          QUOTA_PAUSE_HOURS * 3600 * 1000,
          err.message,
        );
      } else {
        setAccountState(
          targetAccountId,
          ACCOUNT_STATES.COOLDOWN,
          5 * 60 * 1000,
          err.message,
        );
      }

      console.warn(
        `⏸️ ${recipient.email} requeued — account ${targetAccountId} unavailable: ${err.message}`,
      );

      // Release recipient safely
      await prisma.campaignRecipient
        .updateMany({
          where: { id: recipient.id, status: "processing" },
          data: {
            status: "pending",
            updatedAt: new Date(),
            error: `Waiting: ${String(err.message || "Account cannot send").slice(0, 200)}`,
          },
        })
        .catch((releaseErr) => {
          console.error(
            `⚠️ [${ctx.account.email}] failed to requeue ${recipient.email}: ${releaseErr.message}`,
          );
        });

      return { outcome: "account_error" };
    }

    /*
     * RECIPIENT-LEVEL / NORMAL SEND FAILURE
     */
    console.error(`❌ Failed → ${recipient.email}: ${err.message}`);

    const permanent = isPermanentError(err);
    const nextRetryCount = (recipient.retryCount || 0) + 1;
    const errMsg = err.message?.slice(0, 500) || "Unknown error";

    /*
     * TRANSIENT ERROR
     *
     * Return the recipient to pending and retry it later.
     */
    if (!permanent && nextRetryCount <= MAX_TRANSIENT_RETRIES) {
      await prisma.campaignRecipient
        .update({
          where: {
            id: recipient.id,
          },
          data: {
            status: "pending",
            retryCount: nextRetryCount,
            lastTriedAt: new Date(),
            updatedAt: new Date(),
            error:
              `Retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} ` +
              `scheduled: ${errMsg}`,
          },
        })
        .catch(() => {});

      return {
        outcome: "retry",
        retryDelayMs: Math.min(2000 * nextRetryCount, 10_000),
      };
    }

    /*
     * PERMANENT ERROR OR MAX RETRIES EXCEEDED
     */
    await prisma.campaignRecipient
      .update({
        where: {
          id: recipient.id,
        },
        data: {
          status: "failed",
          retryCount: nextRetryCount,
          lastTriedAt: new Date(),
          updatedAt: new Date(),
          error: permanent
            ? errMsg
            : `Max retries (${MAX_TRANSIENT_RETRIES}) exceeded: ${errMsg}`,
        },
      })
      .catch(() => {});

    return {
      outcome: "failed",
    };
  }
}

/**
 * Send a claimed batch one email at a time. Each send takes a global slot;
 * the pacing sleep does not.
 * @returns {Promise<"continue"|"stop">}
 */
async function runBatch(batch, ctx) {
  for (let i = 0; i < batch.length; i++) {
    const recipient = batch[i];

    let result;

    try {
      result = await globalAccountLimit(() => processRecipient(recipient, ctx));
    } catch (err) {
      /*
       * DB outage / unexpected error during heartbeat or assignment.
       *
       * Do NOT immediately mark the recipient failed.
       * Leave it as "processing" so the worker's recovery sweep can
       * safely return it to "pending".
       */
      console.error(
        `⚠️ [${ctx.account.email}] send step failed (${err.message}) ` +
          `— leaving row for recovery and pausing 10s`,
      );

      await sleep(10_000);
      continue;
    }

    /*
     * STOP
     *
     * Campaign was stopped/completed, or another condition explicitly
     * requested the account processor to stop.
     */
    if (result.outcome === "stop") {
      const rest = batch.slice(i + 1).map((r) => r.id);

      if (rest.length) {
        await prisma.campaignRecipient
          .updateMany({
            where: {
              id: { in: rest },
              status: "processing",
            },
            data: {
              status: "pending",
              updatedAt: new Date(),
            },
          })
          .catch((err) => {
            console.error(
              `⚠️ [${ctx.account.email}] failed to release remaining ` +
                `batch rows: ${err.message}`,
            );
          });
      }

      console.log(
        `⏹ [${ctx.account.email}] batch stopped — ` +
          `${rest.length} remaining recipient(s) returned to pending`,
      );

      return "stop";
    }

    /*
     * ACCOUNT ERROR / PAUSE
     * Stop processing so `processAccountBatched` exits and the queue unlocks.
     */
    if (
      result.outcome === "account_error" ||
      result.outcome === "account_paused"
    ) {
      const rest = batch.slice(i + 1).map((r) => r.id);
      if (rest.length) {
        await prisma.campaignRecipient
          .updateMany({
            where: { id: { in: rest }, status: "processing" },
            data: { status: "pending", updatedAt: new Date() },
          })
          .catch((err) => {
            console.error(
              `⚠️ [${ctx.account.email}] failed to release rows: ${err.message}`,
            );
          });
      }
      console.warn(
        `⏸️ [${ctx.account.email}] account unavailable — stopping processor. Released ${rest.length} rows to pending.`,
      );
      return "stop";
    }

    /*
     * Retry delay requested by processRecipient().
     */
    if (result.retryDelayMs) {
      await sleep(result.retryDelayMs);
    }

    /*
     * Pacing only after a real send attempt.
     *
     * Skipped/suppressed recipients should not consume the normal
     * sending delay.
     */
    if (!["skipped", "suppressed"].includes(result.outcome)) {
      await sleep(ctx.delayPerEmail);
    }
  }

  return "continue";
}

/**
 * Process all pending recipients assigned to one account.
 */
async function processAccountBatched({
  campaignId,
  accountId,
  campaign,
  assign,
  originalCampaignId,
  customLimits,
  userId,
}) {
  const senders = createSenderCache();

  try {
    const primary = await senders.get(accountId);

    if (!primary) {
      console.error(
        `❌ Campaign ${campaignId}: invalid or missing SMTP account ${accountId}`,
      );
      return;
    }

    const { account, transporter, fromEmail } = primary;

    const limit = getLimit(account.provider || "", account.id, customLimits);

    const ctx = {
      account,
      transporter,
      fromEmail,
      smtpIp: await getSmtpIp(account.smtpHost),
      campaign,
      assign,
      originalCampaignId,
      senders,
      limit,
      delayPerEmail: (60 * 60 * 1000) / Math.max(limit, 1),

      // Runtime flags used by claimNextBatch().
      pauseLogged: false,
      capLogged: false,
      stateLogged: false,
    };

    const numericAccountId = Number(accountId);

    console.log(
      `▶️ Campaign ${campaignId}: starting account processor ` +
        `${account.email} (accountId=${numericAccountId}, limit=${limit})`,
    );

    while (true) {
      let next;

      try {
        next = await globalAccountLimit(() =>
          claimNextBatch({
            campaignId,
            accountId: numericAccountId,
            userId,
            ctx,
          }),
        );
      } catch (err) {
        console.error(
          `❌ Campaign ${campaignId} [${account.email}] ` +
            `claim processor error: ${err.message}`,
        );

        // Do not kill the entire worker because one account's claim failed.
        await sleep(5000);
        continue;
      }

      // Campaign stopped / completed / account paused.
      //
      // claimNextBatch() returns "stop" when:
      //   - campaign is no longer sending, OR
      //   - this sending account has been paused.
      //
      // IMPORTANT:
      // Do not wait forever here. Exit this account processor so that
      // a paused/problematic account cannot hold the campaign open.
      if (next.action === "stop") {
        console.log(
          `⏹ Campaign ${campaignId}: stopping account processor ` +
            `${account.email}`,
        );
        return;
      }

      // No pending recipients remain for this account.
      if (next.action === "done") {
        console.log(
          `✅ Campaign ${campaignId}: account ${account.email} ` +
            `has no pending recipients`,
        );
        return;
      }

      // Temporary condition:
      // database check failed, another worker currently owns rows,
      // daily limit reached, etc.
      if (next.action === "wait") {
        await sleep(next.ms);
        continue;
      }

      // We received a batch to send.
      if (next.action === "send") {
        if (!Array.isArray(next.batch) || next.batch.length === 0) {
          console.warn(
            `⚠️ Campaign ${campaignId} [${account.email}] ` +
              `received an empty send batch — retrying`,
          );

          await sleep(2000);
          continue;
        }

        let result;

        try {
          result = await runBatch(next.batch, ctx);
        } catch (err) {
          console.error(
            `❌ Campaign ${campaignId} [${account.email}] ` +
              `batch failed: ${err.message}`,
          );

          // runBatch() should normally handle individual recipient
          // failures itself. If an unexpected batch-level error occurs,
          // wait briefly and allow the next worker iteration to recover
          // processing rows through the stuck-row recovery mechanism.
          await sleep(5000);
          continue;
        }

        // runBatch() can explicitly tell this account processor to stop.
        if (result === "stop") {
          console.log(
            `⏹ Campaign ${campaignId}: runBatch requested stop for ` +
              `${account.email}`,
          );
          return;
        }
      }
    }
  } finally {
    // Always close/release sender resources for this account processor.
    try {
      senders.closeAll();
    } catch (err) {
      console.error(
        `⚠️ Campaign ${campaignId}: failed to close sender cache ` +
          `for account ${accountId}: ${err.message}`,
      );
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — sendOneNormal
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Best-effort write of the Sent-folder record. A failure here is logged and
 * ignored — it must never cause the email to be sent again.
 */
async function logSentMessage({
  account,
  fromEmail,
  recipientEmail,
  subject,
  html,
  messageId,
}) {
  const conversationId = `${account.id}_sent_${recipientEmail}`;
  try {
    await prisma.conversation.upsert({
      where: { id: conversationId },
      update: { lastMessageAt: new Date() },
      create: {
        id: conversationId,
        emailAccountId: account.id,
        subject,
        participants: `${fromEmail}, ${recipientEmail}`,
        toRecipients: recipientEmail,
        initiatorEmail: fromEmail,
        lastMessageAt: new Date(),
        messageCount: 1,
        unreadCount: 0,
      },
      select: { id: true },
    });

    await prisma.emailMessage.upsert({
      where: {
        emailAccountId_messageId: { emailAccountId: account.id, messageId },
      },
      update: { subject, body: html, sentAt: new Date() },
      create: {
        emailAccountId: account.id,
        messageId,
        conversationId,
        subject,
        fromEmail,
        fromName: account.senderName || null,
        toEmail: recipientEmail,
        body: html,
        direction: "sent",
        folder: "sent",
        sentAt: new Date(),
        isRead: true,
      },
      select: { id: true },
    });
  } catch (e) {
    console.error(
      `⚠️ Sent-record write failed for ${recipientEmail} (ignored): ${e.message}`,
    );
  }
}

async function markSkipped(recipientId, reason) {
  await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, status: { in: ["processing", "pending"] } },
    data: {
      status: "skipped",
      error: String(reason).slice(0, 300),
      updatedAt: new Date(),
    },
  });
}

async function markSent(recipientId, data) {
  try {
    await writeWithRetry(
      () =>
        prisma.campaignRecipient.update({
          where: { id: recipientId },
          data: {
            status: "sent",
            sentAt: new Date(),
            updatedAt: new Date(),
            error: null,
            ...data,
          },
          select: { id: true },
        }),
      `markSent(${recipientId})`,
    );
  } catch (err) {
    err.alreadySent = true;
    throw err;
  }
}

async function sendOneNormal({ recipient, ctx, assignment }) {
  const { account, transporter, fromEmail, campaign, smtpIp } = ctx;
  const { subject: rawSubject, pitchBody: rawBody } = assignment;

  // Personalisation: {{firstName}}, {{company|your team}} … (Phase 3)
  const needsVars = hasMergeFields(rawSubject) || hasMergeFields(rawBody);
  const vars = needsVars ? await mergeVarsFor(recipient.email) : null;

  const personalSubject = needsVars
    ? renderMergeFields(rawSubject || "", vars, { html: false })
    : rawSubject;

  const label = getDomainLabel(recipient.email);
  const subject = `${label} - ${personalSubject}`;

  let body = normalizeHtmlForEmail(
    needsVars ? renderMergeFields(rawBody || "", vars) : rawBody || "",
  );

  const baseStyles = extractBaseStyles(body);

  const unsafeColors = ["#fff", "#ffffff", "white", "transparent"];

  if (
    !baseStyles.color ||
    unsafeColors.includes(baseStyles.color.toLowerCase())
  ) {
    baseStyles.color = "#000000";
  }

  const signature = buildSignature(account, campaign.senderRole, baseStyles);

  if (!body.includes("color:") && baseStyles.color !== "#000000") {
    body = `<span style="color:${baseStyles.color};">${body}</span>`;
  }

  const unsub = buildUnsubscribeParts({
    email: recipient.email,
    campaignId: campaign.id,
    recipientId: recipient.id,
    fromEmail,
  });

  const html = buildNormalEmailHtml(
    body,
    signature,
    baseStyles,
    unsub.footerHtml,
  );

  const text = toPlainText(html);

  const messageId = buildCampaignMessageId(
    campaign.id,
    recipient.id,
    fromEmail,
  );

  await sendWithRetry(
    () =>
      transporter.sendMail({
        from: account.senderName
          ? `"${account.senderName}" <${fromEmail}>`
          : fromEmail,
        to: recipient.email,
        subject,
        html,
        ...(text ? { text } : {}),
        messageId,
        headers: {
          [CAMPAIGN_HEADER]: `${campaign.id}-${recipient.id}`,
          ...unsub.headers,
        },
      }),
    {
      retries: 3,
      attemptTimeoutMs: 20000,
      transporter,
    },
  );

  /*
   * The SMTP server accepted the email.
   *
   * Record the send before doing the remaining non-critical logging.
   * If markSent() fails, it throws alreadySent=true so the recipient
   * will not be sent again.
   */
  recordAccountSend(account.id);

  await markSent(recipient.id, {
    accountId: account.id,
    sentBodyHtml: html,
    sentSubject: personalSubject,
    sentFromEmail: fromEmail,
    sendingIp: smtpIp,
  });

  recordDailySend(campaign);

  await logSentMessage({
    account,
    fromEmail,
    recipientEmail: recipient.email,
    subject,
    html,
    messageId,
  });

  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — sendOneFollowup
═══════════════════════════════════════════════════════════════════════════ */

async function findThreadParentId({
  accountId,
  originalCampaignId,
  originalRecipientId,
  fromEmail,
  recipientEmail,
}) {
  // New-style sends have a deterministic, real Message-ID.
  const expected = buildCampaignMessageId(
    originalCampaignId,
    originalRecipientId,
    fromEmail,
  );
  const exact = await prisma.emailMessage.findUnique({
    where: {
      emailAccountId_messageId: {
        emailAccountId: accountId,
        messageId: expected,
      },
    },
    select: { messageId: true },
  });
  if (exact) return exact.messageId;

  // Older sends: earliest message from this account to this person
  // (served by the (emailAccountId, toEmail, sentAt) index).
  const prev = await prisma.emailMessage.findFirst({
    where: { emailAccountId: accountId, toEmail: recipientEmail },
    orderBy: { sentAt: "asc" },
    select: { messageId: true },
  });
  // Old rows stored ids like "campaign-1-5" (not a real Message-ID).
  // Only a bracketed id is a valid threading target.
  return prev?.messageId?.startsWith("<") ? prev.messageId : null;
}

async function sendOneFollowup({ recipient, ctx, assignment }) {
  const { account, campaign, originalCampaignId } = ctx;
  const { subject: fallbackSubject, pitchBody: rawFollowupBody } = assignment;

  const followupVars = hasMergeFields(rawFollowupBody)
    ? await mergeVarsFor(recipient.email)
    : null;
  const followupBody = normalizeHtmlForEmail(
    followupVars
      ? renderMergeFields(rawFollowupBody || "", followupVars)
      : rawFollowupBody || "",
  );
  if (!followupBody || followupBody.trim() === "") {
    throw Object.assign(new Error("Follow-up body is empty"), {
      responseCode: 550,
    });
  }

  // ONE query for everything we need from the original send (was two).
  // Served by the unique (campaignId, email) index.
  const prevEmail = originalCampaignId
    ? await prisma.campaignRecipient.findFirst({
        where: {
          campaignId: originalCampaignId,
          email: recipient.email,
          status: "sent",
        },
        select: {
          id: true,
          accountId: true,
          sentBodyHtml: true,
          sentSubject: true,
          sentFromEmail: true,
          sentAt: true,
          repliedAt: true,
          bounceType: true,
        },
      })
    : null;

  if (!prevEmail) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "failed",
        error: "No original email found",
        updatedAt: new Date(),
      },
    });
    return false;
  }

  // Never follow up with someone who already answered, or whose address
  // hard-bounced.
  if (prevEmail.repliedAt) {
    await markSkipped(recipient.id, "Replied");
    return "skipped";
  }
  if (prevEmail.bounceType === "hard") {
    await markSkipped(recipient.id, "Original email bounced");
    return "skipped";
  }
  if (FEATURES.replyDetection && prevEmail.sentAt) {
    const replied = await prisma.replyEvent.findFirst({
      where: {
        email: recipient.email.toLowerCase(),
        receivedAt: { gte: prevEmail.sentAt },
      },
      select: { id: true },
    });
    if (replied) {
      await markSkipped(recipient.id, "Replied");
      return "skipped";
    }
  }

  // Follow-ups go out from the account that sent the original.
  const senderAccountId = prevEmail.accountId || account.id;
  const sender = await ctx.senders.get(senderAccountId);
  if (!sender) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "failed",
        error: `SMTP account ${senderAccountId} not found`,
        updatedAt: new Date(),
      },
    });
    return false;
  }
  const {
    account: actualAccount,
    transporter: actualTransporter,
    fromEmail: actualFromEmail,
  } = sender;

  if (
    actualAccount.id !== account.id &&
    (await getAccountPause(actualAccount.id)).paused
  ) {
    throw Object.assign(new Error(`Sender ${actualAccount.email} is paused`), {
      accountPaused: true,
      accountId: actualAccount.id,
    });
  }

  const unsub = buildUnsubscribeParts({
    email: recipient.email,
    campaignId: campaign.id,
    recipientId: recipient.id,
    fromEmail: actualFromEmail,
  });

  const baseStyles = extractBaseStyles(followupBody);
  const signature = buildSignature(
    actualAccount,
    campaign.senderRole,
    baseStyles,
  );
  const followupWithSignature = followupBody + signature + unsub.footerHtml;

  let originalBody = extractBodyContent(prevEmail.sentBodyHtml);
  if (!originalBody && prevEmail.sentBodyHtml) {
    originalBody = prevEmail.sentBodyHtml
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<html[^>]*>/gi, "")
      .replace(/<\/html>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<body[^>]*>/gi, "")
      .replace(/<\/body>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
      .trim();
  }

  const originalSubject = prevEmail.sentSubject || fallbackSubject || "";
  const originalFrom = prevEmail.sentFromEmail || actualFromEmail;
  const sentAt = new Date(prevEmail.sentAt || Date.now()).toLocaleString();

  const threadedHtml = buildFollowupHtml({
    followUpBody: followupWithSignature,
    originalBody,
    from: originalFrom,
    to: recipient.email,
    sentAt,
    subject: originalSubject,
    baseColor: baseStyles.color || "#000",
  });

  const html = `<html>
      <body style="font-family:Calibri,sans-serif">
        ${threadedHtml}
      </body>
    </html>`;

  const subject = originalSubject
    ? `Re: ${originalSubject}`
    : `Re: ${fallbackSubject || ""}`;

  const parentId = await findThreadParentId({
    accountId: actualAccount.id,
    originalCampaignId,
    originalRecipientId: prevEmail.id,
    fromEmail: actualFromEmail,
    recipientEmail: recipient.email,
  });

  const messageId = buildCampaignMessageId(
    campaign.id,
    recipient.id,
    actualFromEmail,
  );
  const text = toPlainText(html);
  const headers = {
    [CAMPAIGN_HEADER]: `${campaign.id}-${recipient.id}`,
    ...unsub.headers,
  };
  if (parentId) {
    headers["In-Reply-To"] = parentId;
    headers["References"] = parentId;
  }

  try {
    await sendWithRetry(
      () =>
        actualTransporter.sendMail({
          from: actualAccount.senderName
            ? `"${actualAccount.senderName}" <${actualFromEmail}>`
            : actualFromEmail,
          to: recipient.email,
          subject,
          html,
          ...(text ? { text } : {}),
          messageId,
          headers,
        }),
      {
        retries: 3,
        attemptTimeoutMs: 20000,
        transporter: actualTransporter,
      },
    );
  } catch (err) {
    if (isQuotaError(err) || isAccountAuthError(err)) {
      err.accountId = actualAccount.id;
      throw err;
    }
    console.error("❌ FOLLOW-UP SEND ERROR:", {
      email: recipient.email,
      account: actualAccount.email,
      error: err.message,
      code: err.code,
      response: err.response,
    });
    throw err;
  }

  recordAccountSend(actualAccount.id);
  await markSent(recipient.id, {
    sentBodyHtml: html,
    sentSubject: prevEmail.sentSubject ?? fallbackSubject,
    sentFromEmail: actualFromEmail,
    sendingIp: await getSmtpIp(actualAccount.smtpHost),
  });
  recordDailySend(campaign);

  await logSentMessage({
    account: actualAccount,
    fromEmail: actualFromEmail,
    recipientEmail: recipient.email,
    subject,
    html,
    messageId,
  });

  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7 — PUBLIC ENTRY POINT  sendBulkCampaign

   Only worker.js calls this. `activeCampaigns` prevents two send loops for
   the same campaign inside the worker; the SKIP LOCKED claim above keeps
   sending correct even if a second worker is ever started by mistake.
═══════════════════════════════════════════════════════════════════════════ */

const activeCampaigns = new Set();

/** True if this process is already sending the campaign. */
export function isCampaignActive(campaignId) {
  return activeCampaigns.has(Number(campaignId));
}

export async function sendBulkCampaign(campaignId) {
  campaignId = Number(campaignId);
  if (activeCampaigns.has(campaignId)) return;
  activeCampaigns.add(campaignId);

  try {
    await _sendBulkCampaignInner(campaignId);
  } finally {
    activeCampaigns.delete(campaignId);
    statusCache.delete(campaignId);
  }
}

async function failCampaign(campaignId, message) {
  console.error(`❌ Campaign ${campaignId}: ${message}`);
  await prisma.campaign
    .update({
      where: { id: campaignId },
      data: { status: "failed", error: message },
    })
    .catch(() => {});
}

async function _sendBulkCampaignInner(campaignId) {
  // ── 1. Load campaign (only the columns we use) ─────────────────────────
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      userId: true,
      status: true,
      sendType: true,
      subject: true,
      bodyHtml: true,
      pitchIds: true,
      customLimits: true,
      senderRole: true,
      parentCampaignId: true,
      estimatedCompletion: true,
      user: { select: { name: true, empId: true } },
    },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status !== "sending") return;

  const { userId } = campaign;

  // ── 2. Global gate — daily limit ──────────────────────────────────────
  const sentToday = await getDailyCount(userId, { fresh: true });
  if (sentToday >= DAILY_LIMIT) {
    const waitMs = msUntilNextWindow();
    console.log(
      `🚫 Daily limit reached before start of campaign ${campaignId}. Sleeping ${Math.ceil(waitMs / 60000)} min.`,
    );
    await sleep(waitMs);
  }

  console.log(
    `📦 Campaign ${campaignId} loaded (type=${campaign.sendType}, sentToday=${sentToday})`,
  );

  // ── 3. Parse config ────────────────────────────────────────────────────
  let customLimits = {};
  if (campaign.customLimits) {
    try {
      customLimits = JSON.parse(campaign.customLimits) || {};
    } catch (err) {
      console.error("Failed to parse customLimits:", err.message);
    }
  }

  let subjects = [];
  try {
    subjects = JSON.parse(campaign.subject || "[]");
  } catch {
    subjects = campaign.subject ? [campaign.subject] : [];
  }
  if (!Array.isArray(subjects)) subjects = [String(subjects)];
  subjects = subjects.filter(Boolean);

  // Follow-ups fall back to the original subject, so they may have none.
  if (!subjects.length && campaign.sendType !== "followup") {
    // Previously this threw — and the worker retried (and reloaded every
    // recipient) every tick, forever.
    await failCampaign(campaignId, "Subjects missing");
    return;
  }

  let pitchIds = [];
  try {
    pitchIds = JSON.parse(campaign.pitchIds || "[]");
  } catch {
    pitchIds = [];
  }

  let pitchBodies = [];
  if (Array.isArray(pitchIds) && pitchIds.length) {
    const pitches = await prisma.pitchTemplate.findMany({
      where: { id: { in: pitchIds.map(Number).filter(Number.isInteger) } },
      select: { bodyHtml: true },
    });
    pitchBodies = pitches.map((p) => p.bodyHtml).filter(Boolean);
  }
  if (!pitchBodies.length) pitchBodies = [campaign.bodyHtml];

  // ── 4. Resolve root campaign for follow-ups ────────────────────────────
  let originalCampaignId = null;
  if (campaign.sendType === "followup") {
    if (!campaign.parentCampaignId) {
      await failCampaign(campaignId, "Follow-up has no parent campaign");
      return;
    }
    originalCampaignId = await resolveOriginalCampaignId(
      campaign.parentCampaignId,
    );
  }

  // ── 5a. Skip suppressed / already-replied recipients in bulk ───────────
  const suppressedCount = await skipSuppressedRecipients(campaignId);
  if (suppressedCount > 0) {
    console.log(
      `🚫 Campaign ${campaignId}: ${suppressedCount} recipient(s) on the do-not-contact list skipped`,
    );
  }
  if (campaign.sendType === "followup" && FEATURES.replyDetection) {
    const repliedCount = await prisma.$executeRaw`
      UPDATE "CampaignRecipient" cr
      SET "status" = 'skipped', "error" = 'Replied', "updatedAt" = NOW()
      WHERE cr."campaignId" = ${campaignId}
        AND cr."status" = 'pending'
        AND EXISTS (
          SELECT 1 FROM "CampaignRecipient" o
          WHERE o."campaignId" = ${originalCampaignId}
            AND o."email" = cr."email"
            AND o."status" = 'sent'
            AND (
              o."repliedAt" IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM "ReplyEvent" e
                WHERE e."email" = lower(o."email")
                  AND e."receivedAt" >= o."sentAt"
              )
            )
        )
    `;
    if (repliedCount > 0) {
      console.log(
        `💬 Campaign ${campaignId}: ${repliedCount} recipient(s) already replied — follow-up skipped`,
      );
    }
  }

  // ── 5b. Load pending recipients (narrow columns) ───────────────────────
  let pendingRecipients;
  if (campaign.sendType === "followup") {
    // Was: load every sent address of the original campaign into Node,
    // then `email IN (...thousands of params...)`. One join instead.
    // Rows with no matching sent original are left for sendOneFollowup
    // to fail explicitly — here we only need the ones we can send.
    pendingRecipients = await prisma.$queryRaw`
      SELECT cr."id", cr."accountId"
      FROM "CampaignRecipient" cr
      WHERE cr."campaignId" = ${campaignId}
        AND cr."status" = 'pending'
        AND EXISTS (
          SELECT 1 FROM "CampaignRecipient" o
          WHERE o."campaignId" = ${originalCampaignId}
            AND o."email"      = cr."email"
            AND o."status"     = 'sent'
        )
      ORDER BY cr."id"
    `;

    // Pending follow-up rows whose original was never sent can never
    // succeed; fail them now so the campaign can complete.
    const orphaned = await prisma.$executeRaw`
      UPDATE "CampaignRecipient" cr
      SET "status" = 'failed', "error" = 'No original email found', "updatedAt" = NOW()
      WHERE cr."campaignId" = ${campaignId}
        AND cr."status" = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM "CampaignRecipient" o
          WHERE o."campaignId" = ${originalCampaignId}
            AND o."email"      = cr."email"
            AND o."status"     = 'sent'
        )
    `;
    if (orphaned > 0) {
      console.log(
        `ℹ️ Campaign ${campaignId}: ${orphaned} follow-up recipient(s) had no sent original — marked failed`,
      );
    }
  } else {
    pendingRecipients = await prisma.campaignRecipient.findMany({
      where: { campaignId, status: "pending" },
      select: { id: true, accountId: true },
      orderBy: { id: "asc" },
    });
  }

  if (!pendingRecipients.length) {
    await updateCampaignStatus(campaignId);
    return;
  }

  // ── 6. Subject / pitch assignment ──────────────────────────────────────
  const count = pendingRecipients.length;
  const subjectPlan = subjects.length ? distribute(subjects, count) : [];
  const pitchPlan = distribute(pitchBodies, count);

  const assignmentMap = new Map();
  pendingRecipients.forEach((r, idx) => {
    assignmentMap.set(r.id, {
      subject: subjectPlan[idx],
      pitchBody: pitchPlan[idx],
    });
  });

  // Rows that become pending later (retries, recovered rows) still get a
  // stable assignment instead of failing with "No assignment found".
  const assign = (recipientId) =>
    assignmentMap.get(recipientId) || {
      subject: subjects.length
        ? subjects[recipientId % subjects.length]
        : undefined,
      pitchBody: pitchBodies[recipientId % pitchBodies.length],
    };

  // ── 7. Dispatch per-account loops ──────────────────────────────────────
  // Fetch ALL accounts ever mapped to this campaign to spin up active worker pools.
  const allCampaignAccounts = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    select: { accountId: true },
    distinct: ["accountId"],
  });

  const accountIds = [
    ...new Set(
      allCampaignAccounts
        .map((r) => r.accountId)
        .filter(Boolean)
        .map(Number),
    ),
  ];

  if (!accountIds.length) {
    await failCampaign(campaignId, "No sender accounts assigned to campaign");
    return;
  }

  // High-visibility telemetry log for debugging
  const initStats = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const printStats = initStats
    .map((s) => `${s.status}: ${s._count._all}`)
    .join(" | ");

  console.log(
    `🚀 Campaign ${campaignId} Dispatcher: \n   Accounts: ${accountIds.length} \n   Stats: ${printStats}`,
  );

  // Free the big arrays before the long-running loops.
  pendingRecipients = null;

  await Promise.all(
    accountIds.map((accountId) =>
      processAccountBatched({
        campaignId,
        accountId,
        campaign,
        assign,
        originalCampaignId,
        customLimits,
        userId,
      }).catch((err) => {
        console.error(`❌ Account ${accountId} processor error:`, err.message);
      }),
    ),
  );

  // ── 8. Final status ────────────────────────────────────────────────────
  await Promise.all([
    flushDailyLog().catch(() => {}),
    flushAccountSends().catch(() => {}),
  ]);
  await updateCampaignStatus(campaignId);

  console.log(`✅ Campaign ${campaignId} send loop finished`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8 — updateCampaignStatus
═══════════════════════════════════════════════════════════════════════════ */

async function updateCampaignStatus(campaignId) {
  const stats = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const counts = { sent: 0, failed: 0, pending: 0, processing: 0 };
  for (const row of stats) {
    counts[row.status] = (counts[row.status] || 0) + row._count._all;
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, status: true },
  });
  if (!campaign) return;

  // A user's Stop wins over anything computed here.
  if (campaign.status === "stopped") return;

  let finalStatus;
  if (counts.pending > 0 || counts.processing > 0) {
    finalStatus = "sending";
  } else if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  } else {
    finalStatus = "completed";
  }

  if (finalStatus !== campaign.status) {
    // Conditional update: don't overwrite a Stop that happened meanwhile.
    await prisma.campaign.updateMany({
      where: { id: campaignId, status: { not: "stopped" } },
      data: { status: finalStatus },
    });
    console.log(`Campaign ${campaignId} status → ${finalStatus}`);
  }

  statusCache.delete(campaignId);

  // Only clears THIS process's cache; the API process uses short TTLs.
  delByPrefix(`dashboard:${campaign.userId}:`);
}
