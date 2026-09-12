// campaignMailer.service.js — Fixed: parallel sending, no infinite loops, proper locks

import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import { decrypt } from "../utils/crypto.js";
import cache from "../utils/cache.js";
import dns from "dns/promises";
import pLimit from "p-limit";


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — GLOBAL DAILY LIMIT HELPERS
   ─────────────────────────────────────────────────────────────────────────
   Business rules:
   • Max 5 000 emails per user per "day"
   • A "day" starts at 17:00 (5 PM) and ends at 16:59:59 the following day
   • Emails are only delivered between 17:00 → 04:59 (5 PM → 5 AM)
   • Outside that window the sender pauses and polls until 17:00 resumes
═══════════════════════════════════════════════════════════════════════════ */

const DAILY_LIMIT = 5000;

/**
 * Returns a stable Redis key for the current "day bucket".
 * The bucket starts at 17:00 local time.
 * @param {number|string} userId
 * @returns {string}
 */
export function getTodayKey(userId) {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  const bucketStart = now < resetToday
    ? new Date(resetToday.getTime() - 86_400_000)
    : resetToday;

  const dateLabel = bucketStart.toISOString().split("T")[0];
  return `mail_limit:${userId}:${dateLabel}`;
}

function getTodayStart() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  const start =
    now < resetToday
      ? new Date(resetToday.getTime() - 24 * 60 * 60 * 1000)
      : resetToday;

  start.setMilliseconds(0);
  return start;
}

/**
 * Fetch how many emails this user has sent in the current bucket.
 * @param {number|string} userId
 * @returns {Promise<number>}
 */
export async function getDailyCount(userId) {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  const start =
    now < resetToday
      ? new Date(resetToday.getTime() - 24 * 60 * 60 * 1000)
      : resetToday;

  const result = await prisma.dailyEmailLog.aggregate({
    _sum: { count: true },
    where: {
      userId,
      sentAt: { gte: start },
    },
  });

  return result._sum.count || 0;
}

/**
 * Returns milliseconds until the next 17:00 (5 PM) reset.
 * @returns {number}
 */
export function msUntilNextWindow() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  const next = new Date(now);
  next.setHours(17, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — UTILITY HELPERS
═══════════════════════════════════════════════════════════════════════════ */

async function getSmtpIp(host) {
  try {
    const result = await dns.lookup(host);
    return result.address;
  } catch {
    return "unknown";
  }
}

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
  baseColor
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
  const name =
    account.senderName ||
    account.email?.split("@")[0] ||
    "Sender";

  const role     = senderRole?.trim() || "Marketing Analyst";
  const sigColor = baseStyles.color      || "#000000";
  const sigFont  = baseStyles.fontFamily || "Calibri, sans-serif";
  const sigSize  = baseStyles.fontSize   || "16px";

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

    const wrapperRegex = /<div[^>]+style\s*=\s*["'][^"']*font-family[^"']*["'][^>]*>/i;
    const wrapperMatch = bodyContent.match(wrapperRegex);

    if (wrapperMatch) {
      const openTag    = wrapperMatch[0];
      const startIdx   = bodyContent.indexOf(openTag);
      const innerStart = startIdx + openTag.length;

      let depth = 1;
      let pos   = innerStart;
      while (pos < bodyContent.length && depth > 0) {
        const nextOpen  = bodyContent.indexOf("<div",  pos);
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

// FIX: moved chunkArray to top-level so it's available everywhere
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const SAFE_LIMITS = {
  gmail:  50,
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
  if (domain.includes("gmail"))   return "gmail";
  if (domain.includes("yahoo"))   return "yahoo";
  if (domain.includes("outlook") || domain.includes("hotmail")) return "outlook";
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
    '<p$1 style="margin:0; padding:0; mso-margin-top-alt:0; mso-margin-bottom-alt:0; line-height:1.4;">'
  );

  return cleaned;
}

function extractBaseStyles(html) {
  const fontFamilyMatch = html.match(/font-family:\s*([^;}"']+)/i);
  const fontSizeMatch   = html.match(/font-size:\s*([^;}"']+)/i);

  const UNSAFE = new Set(["#fff", "#ffffff", "white", "transparent", "inherit", ""]);
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
    const spanColor = html.match(/<span[^>]*style="[^"]*\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (spanColor) {
      const c = spanColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  return {
    fontFamily: fontFamilyMatch ? fontFamilyMatch[1].trim() : "Calibri, sans-serif",
    fontSize:   fontSizeMatch   ? fontSizeMatch[1].trim()   : "15px",
    color,
  };
}

const BATCH_SIZE  = 10;
// ONE email at a time per account. runBatch chunks each batch by this value
// and sleeps once per chunk, so 1 means every individual email gets its own
// pacing delay. Raising this re-introduces parallel sends per account.
const CONCURRENCY = 1;
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL BATCH CONCURRENCY CAP

   Previously, "dispatch accounts in parallel" (step 8 below) only capped
   concurrency WITHIN one campaign's Promise.all — it had no idea any other
   campaign existed. resumeSendingCampaignsSafe (worker.js) fires
   sendBulkCampaign() for every campaign that's "sending" WITHOUT awaiting
   each one, so with N campaigns active at once, ALL of their accounts ran
   in parallel simultaneously — e.g. 22 campaigns × ~15 accounts each is
   hundreds of concurrent send-lanes, every one issuing DB queries (status
   checks, batch fetch/lock, per-recipient updates, follow-up threading
   lookups) against a single connection pool. No pool size survives that.

   FIRST ATTEMPT (revised): wrapping each account's ENTIRE remaining send
   loop in this limiter did cap total DB load, but a slot was then held by
   one account for its whole campaign — often minutes to hours. With 22
   campaigns and a handful of slots, whichever accounts grabbed a slot
   first could occupy every slot for a long time, so other campaigns'
   accounts never got a turn and looked completely stalled.

   Current design: each account acquires this limiter for ONE BATCH only
   (see runOneBatchCycle), then releases it and re-queues for its next
   batch. This is a MODULE-level singleton shared across every campaign in
   this process, so all accounts — regardless of which campaign they
   belong to — round-robin fairly through the same small set of slots,
   holding one only for the few seconds a batch takes, not for an entire
   campaign's duration. Long waits (daily-limit reset, DB retry backoff)
   happen OUTSIDE the slot, so a waiting account doesn't block others either.

   Tune via env var against (PRISMA_POOL_SIZE) and how many DB queries one
   batch issues — a good starting point is roughly pool_size / 2, leaving
   headroom for the scheduler, recovery jobs, and the API process sharing
   the same database.
═══════════════════════════════════════════════════════════════════════════ */
const ACCOUNT_CONCURRENCY = Number(process.env.ACCOUNT_CONCURRENCY) || 6;
const globalAccountLimit = pLimit(ACCOUNT_CONCURRENCY);
console.log(`🎛️  Global batch concurrency cap: ${ACCOUNT_CONCURRENCY}`);

function createTransporter(account, smtpPassword) {
  const domain = (account.email.split("@")[1] || "localhost").toLowerCase();
  return nodemailer.createTransport({
    host:    account.smtpHost,
    port:    Number(account.smtpPort),
    secure:  Number(account.smtpPort) === 465,
    name:    domain,
    pool: true,
    // 1, not 2 — a pooled transporter with 2 connections lets a second send
    // start while the first is still in flight, which defeats CONCURRENCY=1.
    maxConnections: 1,
    maxMessages: 50,
    auth: {
      user: account.smtpUser || account.email,
      pass: smtpPassword,
    },
    requireTLS: Number(account.smtpPort) === 587,
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    },
  });
}

function decryptPassword(account) {
  let pass = account.encryptedPass;
  if (typeof pass === "string" && pass.includes(":")) {
    pass = decrypt(pass);
  }
  return pass;
}

async function resolveOriginalCampaignId(startId) {
  let currentId = startId;
  const MAX_LEVELS = 10;

  for (let level = 0; level < MAX_LEVELS; level++) {
    const ancestor = await prisma.campaign.findUnique({
      where:  { id: currentId },
      select: { id: true, sendType: true, parentCampaignId: true },
    });

    if (!ancestor) break;
    if (ancestor.sendType !== "followup" || !ancestor.parentCampaignId) break;

    currentId = ancestor.parentCampaignId;
  }

  console.log(`🔍 Resolved originalCampaignId=${currentId}`);
  return currentId;
}

function buildNormalEmailHtml(body, signature, baseStyles) {
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
  const msg  = (err.message  || "").toLowerCase();
  const code = err.responseCode || err.code;

  // Any SMTP 5xx reply is a hard bounce / permanent rejection by definition.
  if (typeof code === "number" && code >= 500 && code < 600) return true;

  return (
    /\b55[0-9]\b/.test(msg)                ||   // 550, 551, 553, 554...
    msg.includes("no such user")           ||
    msg.includes("user unknown")           ||
    msg.includes("user not found")         ||
    msg.includes("mailbox not found")      ||
    msg.includes("mailbox unavailable")    ||
    msg.includes("recipient address rejected") ||
    msg.includes("address rejected")       ||
    msg.includes("recipient rejected")     ||
    msg.includes("does not exist")         ||
    msg.includes("invalid recipient")      ||
    msg.includes("invalid mailbox")        ||
    msg.includes("no mailbox")             ||
    msg.includes("relay access denied")    ||
    msg.includes("authentication failed")  ||
    msg.includes("invalid login")          ||
    msg.includes("invalid credentials")    ||
    msg.includes("bad credentials")        ||
    msg.includes("eauth")                  ||
    msg.includes("invalid address")        ||
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

  const msg  = (err.message || "").toLowerCase();
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
async function sendWithRetry(sendFn, { retries = 3, attemptTimeoutMs = 20000 } = {}) {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      return await Promise.race([
        sendFn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SMTP attempt timed out")), attemptTimeoutMs)
        ),
      ]);
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ SMTP attempt ${i}/${retries} failed:`, err.message);

      if (isPermanentError(err)) throw err; // fail fast, don't burn retries

      if (i < retries) {
        const backoff = Math.min(2000 * 2 ** (i - 1), 15000);
        await sleep(backoff);
      }
    }
  }
  throw lastError;
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — PER-ACCOUNT BATCH PROCESSOR
   
   FIX SUMMARY:
   1. runBatch() moved OUTSIDE the while loop (was defined after its call)
   2. while(true) with empty batch now BREAKs instead of continuing forever
   3. CONCURRENCY and runBatch are module-level — no re-declarations per loop
   4. Follow-up path properly calls sendOneFollowup (was always calling sendOneNormal)
   5. delayPerEmail removed — no per-email sleep, only batch-level delay
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Run a chunk of recipients in parallel (up to CONCURRENCY at once).
 * Routes to sendOneFollowup or sendOneNormal based on campaign type.
 *
 * @param {object[]} batch           — array of recipient rows (already locked to "processing")
 * @param {object}   ctx             — shared context for the account
 */
async function runBatch(batch, ctx) {
  const {
    account,
    transporter,
    fromEmail,
    smtpIp,
    campaign,
    assignmentMap,
    originalCampaignId,
  } = ctx;

  /* ── BUG 1 FIX: CONCURRENCY was a nested for-loop, not parallel ──────────
     The original code:
       for (group of chunks)           ← group of 2
         for (recipient of group)      ← sequential: send, sleep, send, sleep
     So CONCURRENCY=2 gave zero parallelism. Both sends happened one after
     the other, each with its own sleep().

     Fixed: Promise.all the inner group, sleep ONCE after the group, not
     once per email. This sends up to CONCURRENCY emails in parallel, then
     waits one interval before the next group.                             */
  const chunks = chunkArray(batch, CONCURRENCY);

  for (const group of chunks) {
    await Promise.all(group.map(async (recipient) => {
      const assignment = assignmentMap.get(recipient.id);

      if (!assignment) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "failed", error: "No assignment found" },
        }).catch(() => {});
        return;
      }

      if (!EMAIL_FORMAT_RE.test(recipient.email || "")) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "failed", error: "Invalid email address format" },
        }).catch(() => {});
        return;
      }

      try {
        if (campaign.sendType === "followup") {
          await sendOneFollowup({
            recipient, account, transporter, fromEmail,
            campaign, assignment, originalCampaignId,
          });
        } else {
          await sendOneNormal({
            recipient, account, transporter, fromEmail,
            campaign, assignment, smtpIp,
          });
        }
      } catch (err) {
        console.error(`❌ Failed → ${recipient.email}:`, err.message);

        const permanent      = isPermanentError(err);
        const currentRetries = recipient.retryCount || 0;
        const nextRetryCount = currentRetries + 1;
        const errMsg         = err.message?.slice(0, 500) || "Unknown error";

        if (!permanent && nextRetryCount <= MAX_TRANSIENT_RETRIES) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status:      "pending",
              retryCount:  nextRetryCount,
              lastTriedAt: new Date(),
              error:       `Retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} scheduled: ${errMsg}`,
            },
          }).catch(() => {});
          await sleep(Math.min(2000 * nextRetryCount, 10000));
          return;
        }

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status:      "failed",
            retryCount:  nextRetryCount,
            lastTriedAt: new Date(),
            error: permanent
              ? errMsg
              : `Max retries (${MAX_TRANSIENT_RETRIES}) exceeded: ${errMsg}`,
          },
        }).catch(() => {});
      }
    }));

    // Sleep ONCE per group (not once per email) — this is the rate-limiter.
    await sleep(ctx.delayPerEmail);
  }
}



function calculateDynamicDelay({ remainingEmails, estimatedCompletion, limit }) {
  if (!estimatedCompletion) return 1000;

  const remainingTimeMs = new Date(estimatedCompletion).getTime() - Date.now();

  if (remainingTimeMs <= 0 || remainingEmails <= 0) return 500;

  const requiredPerSecond = remainingEmails / (remainingTimeMs / 1000);

  const maxPerSecond = limit / 3600;

  const finalRate = Math.min(requiredPerSecond, maxPerSecond);

  return Math.max(200, 1000 / finalRate); // min 200ms
}

function getControlledDelay({ limit, remainingEmails, estimatedCompletion }) {
  // base delay from limit (STRICT CONTROL)
  const baseDelay = (60 * 60 * 1000) / limit;

  // dynamic boost (if behind schedule)
  if (estimatedCompletion) {
    const remainingTimeMs =
      new Date(estimatedCompletion).getTime() - Date.now();

    if (remainingTimeMs > 0 && remainingEmails > 0) {
      const requiredDelay = remainingTimeMs / remainingEmails;

      // choose faster of two (but not too fast)
      return Math.max(200, Math.min(baseDelay, requiredDelay));
    }
  }

  return baseDelay;
}
/**
 * Process all pending recipients for one account in batched loops.
 *
 * @param {object} opts
 */
async function processAccountBatched({
  campaignId,
  accountId,
  campaign,
  assignmentMap,
  originalCampaignId,
  customLimits,
  userId,
}) {
  const account = await prisma.emailAccount.findUnique({
    where: { id: Number(accountId) },
  });

  if (!account || !account.smtpHost) {
    console.error(`❌ Invalid or missing SMTP account: ${accountId}`);
    return;
  }

  const fromEmail   = account.smtpUser || account.email;
  const password    = decryptPassword(account);
  const transporter = createTransporter(account, password);
  const smtpIp      = await getSmtpIp(account.smtpHost);
  const limit       = getLimit(account.provider, account.id, customLimits);

  // 🔥 DYNAMIC RATE CONTROL (NEW)

  const remainingEmails = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      accountId: Number(accountId),
      status: "pending",
    },
  });

  // const dynamicDelay = calculateDynamicDelay({
  //   remainingEmails,
  //   estimatedCompletion: campaign.estimatedCompletion,
  //   limit,
  // });
  // If no estimated completion, fallback to normal
  let dynamicLimit = limit;

  if (campaign.estimatedCompletion) {
    const remainingTimeMs =
      new Date(campaign.estimatedCompletion).getTime() - Date.now();

    if (remainingTimeMs > 0 && remainingEmails > 0) {
      const requiredPerHour = Math.ceil(
        (remainingEmails / remainingTimeMs) * 3600000
      );

      // Do not exceed provider safe limit
      dynamicLimit = Math.min(requiredPerHour, limit);

      
    }
  }

 
  // console.log(`📤 Account ${account.email}: starting (limit=${limit}/hr, concurrency=${CONCURRENCY})`);
  // console.log(`📡 SMTP: ${account.smtpHost} → ${smtpIp}`);

  // Shared context passed to runBatch — avoids re-building per iteration.
  // campaign lives on ctx (not a local variable) because runOneBatchCycle
  // below needs to mutate its estimatedCompletion across calls, and each
  // call is now a separate turn through the global limiter.
  const ctx = {
    account,
    transporter,
    fromEmail,
    smtpIp,
    campaign,
    assignmentMap,
    originalCampaignId,
    delayPerEmail: 1000,
  };

  /* ═════════════════════════════════════════════════════════════════════
     FAIRNESS FIX

     Previously this whole while(true) loop ran inside ONE globalAccountLimit
     slot, so a slot was held for this account's ENTIRE remaining campaign —
     often many minutes to hours at safe sending rates. With 22 campaigns
     active and only ACCOUNT_CONCURRENCY slots, whichever accounts grabbed a
     slot first could occupy every slot for a long time, and campaigns whose
     accounts hadn't gotten a turn yet (e.g. later campaign IDs) looked
     completely stalled even though the worker was healthy and busy.

     Fix: acquire the global slot for ONE batch only, release it, then
     re-queue for another turn. Long waits (daily-limit reset, transient DB
     retry backoff) happen OUTSIDE the slot too, so they don't tie it up.
     This makes every account/campaign round-robin fairly through the
     shared slots instead of a few campaigns monopolizing them.
  ═════════════════════════════════════════════════════════════════════ */
  while (true) {
    const result = await globalAccountLimit(() =>
      runOneBatchCycle({ campaignId, accountId, account, userId, limit, ctx })
    );

    if (result.action === "stop")  return;   // campaign no longer sending
    if (result.action === "done")  return;   // no more pending recipients
    if (result.action === "wait")  await sleep(result.ms); // outside the slot
    // action === "continue" → loop immediately, re-entering the queue
  }
}

/**
 * One batch's worth of work for one account, run while holding a single
 * global concurrency slot. Returns what the caller should do next so any
 * waiting happens OUTSIDE the slot.
 */
async function runOneBatchCycle({ campaignId, accountId, account, userId, limit, ctx }) {
  // [A] Campaign stop check
  // A transient DB/connection error here (e.g. pool exhaustion under
  // concurrent load) used to throw straight out of this loop, silently
  // killing this account's sender for the rest of the campaign — the
  // recipients it had locked to "processing" then sat stuck until the
  // 3-minute recovery sweep in worker.js. Now we retry instead of
  // aborting, so a DB blip pauses this account briefly rather than
  // ending it.
  let latestCampaign;
  try {
    latestCampaign = await prisma.campaign.findUnique({
      where:  { id: campaignId },
      select: { status: true },
    });
  } catch (err) {
    console.error(
      `⚠️ [${account.email}] campaign status check failed (${err.message}) — retrying in 5s`
    );
    return { action: "wait", ms: 5000 };
  }
  if (!latestCampaign || latestCampaign.status !== "sending") {
    console.log(`⏹ Campaign ${campaignId} stopped — halting account ${account.email}`);
    return { action: "stop" };
  }

  // [B] Global daily-limit check
  const dailyCount = await getDailyCount(userId);
  if (dailyCount >= DAILY_LIMIT) {
    const waitMs  = msUntilNextWindow();
    const waitMin = Math.ceil(waitMs / 60000);
    console.log(`🚫 Daily limit reached. Sleeping ${waitMin} min until reset...`);
    // ── BUG 3 FIX: push estimatedCompletion forward by the sleep time ──
    // Otherwise the deadline is already in the past when we resume and
    // the delay falls back to the slow base rate.
    if (ctx.campaign.estimatedCompletion) {
      ctx.campaign = {
        ...ctx.campaign,
        estimatedCompletion: new Date(
          new Date(ctx.campaign.estimatedCompletion).getTime() + waitMs
        ),
      };
    }
    console.log(`🔄 Will resume campaign ${campaignId} after daily reset...`);
    return { action: "wait", ms: waitMs };
  }

  // [C] Fetch next batch — only "pending" rows for this account
  //
  // ── BUG 2 FIX: delay was computed once before the loop starts ────────
  // As emails are sent, the remaining count drops but the delay never
  // adjusted — so early batches ran at the slow opening pace and there
  // was no way to make up time. Now recomputed every batch so the pace
  // accelerates naturally as the deadline approaches.
  // [C]/[D] wrapped together: a DB blip while counting/fetching/locking
  // the next batch used to throw straight out of this loop and end this
  // account's sender for the rest of the campaign. Now it retries.
  let batch;
  try {
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId, accountId: Number(accountId), status: "pending" },
    });
    ctx.delayPerEmail = getControlledDelay({
      limit,
      remainingEmails: remaining,
      estimatedCompletion: ctx.campaign.estimatedCompletion,
    });
    console.log(
      `[${account.email}] remaining=${remaining} delay=${(ctx.delayPerEmail/1000).toFixed(1)}s`
    );

    batch = await prisma.campaignRecipient.findMany({
      where: {
        campaignId,
        accountId: Number(accountId),
        status:    "pending",
      },
      orderBy: { id: "asc" },
      take:    BATCH_SIZE,
    });

    // FIX: was `continue` here causing infinite loop — now we're DONE
    if (batch.length === 0) {
      console.log(`✅ Account ${account.email}: no more pending recipients — done`);
      return { action: "done" };
    }

    /* ── [D] CLAIM the batch → "processing", ONE ROW AT A TIME ──────────
       ★ DUPLICATE-SEND FIX ★

       The old code issued one bulk updateMany and THREW AWAY the count:

         await prisma.campaignRecipient.updateMany({
           where: { id: { in: batch.map(r => r.id) }, status: "pending" },
           data:  { status: "processing", updatedAt: new Date() },
         });

       Two senders could each read the same rows while they were still
       "pending", then both call runBatch() with their own stale copy. The
       loser's updateMany matched 0 rows and nobody checked, so every
       recipient received TWO emails and produced TWO "sent" records —
       3 recipients showing as 6 in Inbox → Sent.

       Two senders exist because `activeCampaigns` (the in-memory Set guard
       further down this file) is per PROCESS. The API process calls
       sendBulkCampaign() straight from the controllers, and worker.js's
       resumeSendingCampaignsSafe() calls it again on its own 2-minute
       timer. Two Node processes = two Sets, neither able to see the other.

       Scoping updateMany to a SINGLE id makes it a compare-and-set:
       count === 1 comes back only for the sender whose UPDATE actually
       flipped that row from pending → processing. Exactly one sender wins
       each row no matter how many processes are racing, and we send only
       the rows we personally claimed.

       Cost: at most BATCH_SIZE (10) tiny primary-key UPDATEs per batch.   */
    const claimed = [];
    for (const r of batch) {
      const res = await prisma.campaignRecipient.updateMany({
        where: { id: r.id, status: "pending" },
        data:  { status: "processing", updatedAt: new Date() },
      });
      if (res.count === 1) claimed.push(r);
    }

    if (claimed.length === 0) {
      // Another sender took the entire batch between our read and our write.
      // Back off a moment and fetch a fresh batch rather than tight-looping.
      console.log(`↩️ [${account.email}] batch already claimed elsewhere — refetching`);
      return { action: "wait", ms: 1000 };
    }

    if (claimed.length < batch.length) {
      console.log(
        `↩️ [${account.email}] claimed ${claimed.length}/${batch.length} rows ` +
        `— the rest were taken by another sender`
      );
    }

    // Send ONLY what we won. This reassignment is why `batch` is `let`.
    batch = claimed;
  } catch (err) {
    console.error(
      `⚠️ [${account.email}] batch fetch/lock failed (${err.message}) — retrying in 5s`
    );
    return { action: "wait", ms: 5000 };
  }

  // [E] Send batch in parallel (CONCURRENCY emails at a time)
  await runBatch(batch, ctx);

  // [F] Small inter-batch delay to avoid SMTP rate limits.
  // Deliberately short and INSIDE the slot — this is the natural pacing
  // between two batches from the same account, not a long wait, so there's
  // no fairness cost to keeping it here.
  await sleep(300);

  return { action: "continue" };
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — sendOneNormal
═══════════════════════════════════════════════════════════════════════════ */

  async function sendOneNormal({
    recipient,
    account,
    transporter,
    fromEmail,
    campaign,
    assignment,
    smtpIp,
  }) {
    const { subject: rawSubject, pitchBody: rawBody } = assignment;

    const label   = getDomainLabel(recipient.email);
    const subject = `${label} - ${rawSubject}`;

    let body = normalizeHtmlForEmail(rawBody);
    const baseStyles = extractBaseStyles(body);

    const unsafeColors = ["#fff", "#ffffff", "white", "transparent"];
    if (!baseStyles.color || unsafeColors.includes(baseStyles.color.toLowerCase())) {
      baseStyles.color = "#000000";
    }

    const signature = buildSignature(account, campaign.senderRole, baseStyles);

    if (!body.includes("color:") && baseStyles.color !== "#000000") {
      body = `<span style="color:${baseStyles.color};">${body}</span>`;
    }

    const html = buildNormalEmailHtml(body, signature, baseStyles);

    await sendWithRetry(
      () =>
        transporter.sendMail({
          from: account.senderName
            ? `"${account.senderName}" <${fromEmail}>`
            : fromEmail,
          to:      recipient.email,
          subject,
          html,
        }),
      { retries: 3, attemptTimeoutMs: 20000 }
    );

    // messageCount is NOT incremented here any more. This upsert runs once
    // per send ATTEMPT, so a retry inflated the thread's counter even when
    // only one email had actually gone out. The count is now derived from
    // EmailMessage rows, which the upsert below keeps at exactly one per
    // campaign recipient.
    await prisma.conversation.upsert({
      where:  { id: `${account.id}_sent_${recipient.email}` },
      update: {
        lastMessageAt: new Date(),
      },
      create: {
        id:             `${account.id}_sent_${recipient.email}`,
        emailAccountId: account.id,
        subject:        rawSubject || subject,
        participants:   `${fromEmail}, ${recipient.email}`,
        toRecipients:   recipient.email,
        initiatorEmail: fromEmail,
        lastMessageAt:  new Date(),
        messageCount:   1,
        unreadCount:    0,
      },
    });

    /* ★ DUPLICATE-RECORD FIX ★
       messageId was `sent-${Date.now()}-${email}`, so every call — a retry,
       a resend, or a racing second sender — minted a brand-new id and
       create() happily inserted another Sent row.

       Keying the id to the campaign recipient makes it deterministic, and
       upsert() then UPDATES the existing row instead of adding a duplicate.
       One campaign recipient can never produce more than one Sent record.

       ⚠ Requires messageId to be @unique in schema.prisma. If yours is only
         @@index, either add @unique or switch to
         @@unique([emailAccountId, messageId]) and change the `where` below
         to { emailAccountId_messageId: { emailAccountId: account.id,
         messageId: newMessageId } }. Dedupe existing rows before migrating. */
    try {
      const newMessageId = `campaign-${campaign.id}-${recipient.id}`;
      await prisma.emailMessage.upsert({
        where:  { messageId: newMessageId },
        update: {
          subject,
          body:   html,
          sentAt: new Date(),
        },
        create: {
          emailAccountId: account.id,
          messageId:      newMessageId,
          conversationId: `${account.id}_sent_${recipient.email}`,
          subject,
          fromEmail,
          fromName:  account.senderName || null,
          toEmail:   recipient.email,
          body:      html,
          direction: "sent",
          folder:    "sent",
          sentAt:    new Date(),
          isRead:    true,
        },
      });
    } catch (e) {
      console.error("⚠️ Email log failed (ignored):", e.message);
    }

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status:        "sent",
        sentAt:        new Date(),
        accountId:     account.id,
        sentBodyHtml:  html,
        sentSubject:   rawSubject,
        sentFromEmail: fromEmail,
        sendingIp:     smtpIp,
      },
    });

    await prisma.dailyEmailLog.upsert({
      where: {
        userId_sentAt: {
          userId: campaign.userId,
          sentAt: getTodayStart(),
        },
      },
      update: { count: { increment: 1 } },
      create: {
        userId:   campaign.userId,
        userName: campaign.user?.name  || "Unknown",
        empId:    campaign.user?.empId || "N/A",
        count:    1,
        sentAt:   getTodayStart(),
      },
    });
  }


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — sendOneFollowup
═══════════════════════════════════════════════════════════════════════════ */

  async function sendOneFollowup({
    recipient,
    account,
    transporter,
    fromEmail,
    campaign,
    assignment,
    originalCampaignId,
  }) {
    const { subject: fallbackSubject, pitchBody: rawFollowupBody } = assignment;

    const followupBody = normalizeHtmlForEmail(rawFollowupBody);
    if (!followupBody || followupBody.trim() === "") {
      throw new Error("Follow-up body is empty");
    }

    const baseStyles            = extractBaseStyles(followupBody);
    const signature             = buildSignature(account, campaign.senderRole, baseStyles);
    const followupWithSignature = followupBody + signature;

    let prevEmail = null;
    if (originalCampaignId) {
      prevEmail = await prisma.campaignRecipient.findFirst({
        where: {
          campaignId: originalCampaignId,
          email:      recipient.email,
          status:     "sent",
        },
        select: {
          sentBodyHtml:  true,
          sentSubject:   true,
          sentFromEmail: true,
          sentAt:        true,
        },
      });
    }

    if (!prevEmail) {
      console.warn(`❌ No original email record: ${recipient.email}`);
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data:  { status: "failed", error: "No original email found" },
      });
      return;
    }

    let originalBody = extractBodyContent(prevEmail.sentBodyHtml);

    if (!originalBody) {
      console.warn(`⚠️ extractBodyContent empty for ${recipient.email} — using raw fallback`);
      originalBody = prevEmail.sentBodyHtml
        .replace(/<!DOCTYPE[^>]*>/gi, "")
        .replace(/<html[^>]*>/gi, "").replace(/<\/html>/gi, "")
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
        .replace(/<body[^>]*>/gi, "").replace(/<\/body>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
        .trim();
    }

    // console.log(
    //   `📨 originalBody for ${recipient.email}: ${
    //     originalBody ? originalBody.length + " chars extracted" : "EMPTY"
    //   }`
    // );

    const originalSubject = prevEmail.sentSubject  || fallbackSubject || "";
    const originalFrom    = prevEmail.sentFromEmail || fromEmail;
    const sentAt          = new Date(prevEmail.sentAt || Date.now()).toLocaleString();

    const threadedHtml = buildFollowupHtml({
      followUpBody: followupWithSignature,
      originalBody,
      from:      originalFrom,
      to:        recipient.email,
      sentAt,
      subject:   originalSubject,
      baseColor: baseStyles.color || "#000",
    });

    const html = `<html>
      <body style="font-family:Calibri,sans-serif">
        ${threadedHtml}
      </body>
    </html>`;

    const subject = originalSubject ? `Re: ${originalSubject}` : `Re: ${fallbackSubject}`;

    prevEmail.sentBodyHtml = null; // free memory

    const originalAccountRef = await prisma.campaignRecipient.findFirst({
      where: {
        campaignId: originalCampaignId,
        email:      recipient.email,
        status:     "sent",
      },
      select: { accountId: true },
    });

    const accountToUse  = originalAccountRef?.accountId || account.id;
    const actualAccount = await prisma.emailAccount.findUnique({
      where: { id: accountToUse },
    });

    if (!actualAccount || !actualAccount.smtpHost) {
      console.error(`❌ Follow-up skipped (account ${accountToUse} not found): ${recipient.email}`);
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data:  { status: "failed", error: `SMTP account ${accountToUse} not found` },
      });
      return;
    }

    const actualPassword    = decryptPassword(actualAccount);
    const actualTransporter = createTransporter(actualAccount, actualPassword);
    const actualFromEmail   = actualAccount.smtpUser || actualAccount.email;

    const prevEmailMsg = await prisma.emailMessage.findFirst({
      where:   { emailAccountId: actualAccount.id, toEmail: recipient.email },
      orderBy: { sentAt: "asc" },
      select:  { messageId: true },
    });

    const threadingHeaders = prevEmailMsg?.messageId
      ? { "In-Reply-To": prevEmailMsg.messageId, References: prevEmailMsg.messageId }
      : {};

    try {
      await sendWithRetry(
        () =>
          actualTransporter.sendMail({
            from: actualAccount.senderName
              ? `"${actualAccount.senderName}" <${actualFromEmail}>`
              : actualFromEmail,
            to:      recipient.email,
            subject,
            html,
            headers: threadingHeaders,
          }),
        { retries: 3, attemptTimeoutMs: 20000 }
      );
    } catch (err) {
      console.error("❌ FOLLOW-UP SEND ERROR:", {
        email:    recipient.email,
        account:  actualAccount.email,
        error:    err.message,
        code:     err.code,
        response: err.response,
      });
      throw err;
    }

    // ★ DUPLICATE-RECORD FIX ★ — same deterministic-id + upsert as
    // sendOneNormal. See the longer note there for the schema requirement.
    try {
      const newMessageId = `campaign-${campaign.id}-${recipient.id}`;
      await prisma.emailMessage.upsert({
        where:  { messageId: newMessageId },
        update: {
          subject,
          body:   html,
          sentAt: new Date(),
        },
        create: {
          emailAccountId: actualAccount.id,
          messageId:      newMessageId,
          conversationId: `${actualAccount.id}_sent_${recipient.email}`,
          subject,
          fromEmail:      actualFromEmail,
          fromName:       actualAccount.senderName || null,
          toEmail:        recipient.email,
          body:           html,
          direction:      "sent",
          folder:         "sent",
          sentAt:         new Date(),
          isRead:         true,
        },
      });
    } catch (e) {
      console.error("⚠️ Email log failed (ignored):", e.message);
    }

    const smtpIp = await getSmtpIp(actualAccount.smtpHost);

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status:        "sent",
        sentAt:        new Date(),
        sentBodyHtml:  html,
        sentSubject:   prevEmail?.sentSubject ?? fallbackSubject,
        sentFromEmail: actualFromEmail,
        sendingIp:     smtpIp,
      },
    });

    await prisma.dailyEmailLog.upsert({
      where: {
        userId_sentAt: {
          userId: campaign.userId,
          sentAt: getTodayStart(),
        },
      },
      update: { count: { increment: 1 } },
      create: {
        userId:   campaign.userId,
        userName: campaign.user?.name  || "Unknown",
        empId:    campaign.user?.empId || "N/A",
        count:    1,
        sentAt:   getTodayStart(),
      },
    });
  }


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7 — PUBLIC ENTRY POINT  sendBulkCampaign

   activeCampaigns below stops two senders starting inside THIS process.

   ⚠ IT DOES NOT WORK ACROSS PROCESSES. It is a plain in-memory Set, so the
     API process (server.js) and the worker process (worker.js) each hold
     their own copy and neither can see the other's. That is what caused the
     duplicate sends: the controllers called sendBulkCampaign() in the API
     process while resumeSendingCampaignsSafe() called it in the worker.

     Two things now guard against it:
       1. The per-row compare-and-set claim in runOneBatchCycle [D] above —
          the real, process-safe fix. Only one sender can own a row.
       2. Removing the sendBulkCampaign() calls from campaigns.controller.js
          (createCampaign, sendCampaignNow, sendFollowupCampaign) so the API
          process only sets status = "sending" and the worker owns sending.

     Keep BOTH. (1) alone is correct but lets two senders waste effort
     racing; (2) alone reverts to a single in-memory lock that a second
     worker instance would defeat.
═══════════════════════════════════════════════════════════════════════════ */

// Per-PROCESS in-memory lock — see the caveat above.
const activeCampaigns = new Set();

export async function sendBulkCampaign(campaignId) {

  // ── Global lock check ─────────────────────────────────────────────────
  if (activeCampaigns.has(campaignId)) {
    console.log(`🔒 Campaign ${campaignId} already has an active worker — skipping duplicate`);
    return;
  }
  activeCampaigns.add(campaignId);

  try {
    await _sendBulkCampaignInner(campaignId);
  } finally {
    // Always release the lock, even on error
    activeCampaigns.delete(campaignId);
  }
}

async function _sendBulkCampaignInner(campaignId) {

  // ── 1. Load campaign ───────────────────────────────────────────────────
  const campaign = await prisma.campaign.findUnique({
    where:   { id: campaignId },
    include: { user: true },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  if (campaign.status !== "sending") {
    console.log(`⏭️ Campaign ${campaignId} already handled (status=${campaign.status})`);
    return;
  }

  const { userId } = campaign;

  // ── 2. Global gate — daily limit ──────────────────────────────────────
  const sentToday = await getDailyCount(userId);
  if (sentToday >= DAILY_LIMIT) {
    const waitMs  = msUntilNextWindow();
    const waitMin = Math.ceil(waitMs / 60000);
    console.log(`🚫 Daily limit reached before start. Sleeping ${waitMin} min until reset...`);
    await sleep(waitMs);
    console.log(`🔄 Resuming campaign ${campaignId} after reset`);
  }

  console.log("📦 Campaign loaded:", {
    id:             campaign.id,
    status:         campaign.status,
    sendType:       campaign.sendType,
    dailySentSoFar: sentToday,
  });

  // ── 3. Mark as sending (idempotent) ───────────────────────────────────
  await prisma.campaign.update({
    where: { id: campaignId },
    data:  { status: "sending" },
  });

  // ── 4. Parse config ────────────────────────────────────────────────────
  let customLimits = {};
  if (campaign.customLimits) {
    try { customLimits = JSON.parse(campaign.customLimits); }
    catch (err) { console.error("Failed to parse customLimits:", err); }
  }

  let subjects = [];
  try { subjects = JSON.parse(campaign.subject || "[]"); }
  catch { subjects = [campaign.subject]; }
  if (!subjects.length) throw new Error("Subjects missing");

  let pitchIds = [];
  try { pitchIds = JSON.parse(campaign.pitchIds || "[]"); }
  catch { pitchIds = []; }

  let pitchBodies = [];
  if (pitchIds.length) {
    const pitches = await prisma.pitchTemplate.findMany({
      where: { id: { in: pitchIds } },
    });
    pitchBodies = pitches.map(p => p.bodyHtml).filter(Boolean);
  }

  // ── 5. Resolve parent campaign for follow-ups ─────────────────────────
  let originalCampaignId = null;
  if (campaign.sendType === "followup" && campaign.parentCampaignId) {
    originalCampaignId = await resolveOriginalCampaignId(campaign.parentCampaignId);
  }

  // ── 6. Load pending recipients ─────────────────────────────────────────
  let pendingRecipients;

  if (campaign.sendType === "followup") {
    if (!originalCampaignId) {
      console.error(`❌ Campaign ${campaignId}: followup has no resolvable originalCampaignId — aborting`);
      await updateCampaignStatus(campaignId);
      return;
    }

    const originalRecipients = await prisma.campaignRecipient.findMany({
      where:  { campaignId: originalCampaignId, status: "sent" },
      select: { email: true },
    });

    const validEmails = originalRecipients.map(r => r.email);

    pendingRecipients = await prisma.campaignRecipient.findMany({
      where: {
        campaignId,
        status: "pending",
        email:  { in: validEmails },
      },
      select:  { id: true, email: true, accountId: true, retryCount: true },
      orderBy: { id: "asc" },
    });
  } else {
    pendingRecipients = await prisma.campaignRecipient.findMany({
      where:   { campaignId, status: "pending" },
      select:  { id: true, email: true, accountId: true, retryCount: true },
      orderBy: { id: "asc" },
    });
  }

  if (!pendingRecipients.length) {
    console.log(`ℹ️ No pending recipients for campaign ${campaignId}`);
    await updateCampaignStatus(campaignId);
    return;
  }

  // ── 7. Build assignment map ────────────────────────────────────────────
  const count       = pendingRecipients.length;
  const subjectPlan = distribute(subjects, count);
  const pitchPlan   = pitchBodies.length
    ? distribute(pitchBodies, count)
    : distribute([campaign.bodyHtml], count);

  /** @type {Map<number, { subject: string, pitchBody: string }>} */
  const assignmentMap = new Map();
  pendingRecipients.forEach((r, idx) => {
    assignmentMap.set(r.id, {
      subject:   subjectPlan[idx],
      pitchBody: pitchPlan[idx],
    });
  });

  // ── 8. Dispatch per-account processors in parallel ────────────────────
  const accountIds = [
    ...new Set(pendingRecipients.map(r => r.accountId).filter(Boolean)),
  ];

  if (!accountIds.length) {
    console.error(`❌ Campaign ${campaignId}: no accountIds on pending recipients`);
    await updateCampaignStatus(campaignId);
    return;
  }

  console.log(
    `🚀 Campaign ${campaignId}: dispatching ${accountIds.length} account(s); ` +
    `each takes turns through the shared ${ACCOUNT_CONCURRENCY}-slot queue one batch at a time`
  );

  await Promise.all(
    accountIds.map(accountId =>
      processAccountBatched({
        campaignId,
        accountId,
        campaign,
        assignmentMap,
        originalCampaignId,
        customLimits,
        userId,
      }).catch(err => {
        // One account failing should not abort the others
        console.error(`❌ Account ${accountId} processor error:`, err.message);
      })
    )
  );

  // ── 9. Final status update ─────────────────────────────────────────────
  await updateCampaignStatus(campaignId);

  // Delayed re-check to catch any late DB writes
  setTimeout(() => {
    updateCampaignStatus(campaignId).catch(err =>
      console.error(`❌ Delayed status update error for ${campaignId}:`, err.message)
    );
  }, 5000);

  console.log(`✅ Campaign ${campaignId} batch processing complete`);
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8 — updateCampaignStatus
═══════════════════════════════════════════════════════════════════════════ */

async function updateCampaignStatus(campaignId) {

  const stats = await prisma.campaignRecipient.groupBy({
    by:    ["status"],
    where: { campaignId },
    _count: { status: true },
  });

  const counts = { sent: 0, failed: 0, pending: 0, processing: 0 };
  for (const row of stats) {
    counts[row.status] = row._count.status;
  }

  const campaign = await prisma.campaign.findUnique({
    where:  { id: campaignId },
    select: { userId: true, status: true },
  });

  if (campaign?.status === "stopped") {
    console.log(`⏹ Campaign ${campaignId} was stopped — skipping status update`);
    return;
  }

  let finalStatus;

  if (counts.pending > 0 || counts.processing > 0) {
    finalStatus = "sending";
  } else if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  } else {
    finalStatus = "completed";
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data:  { status: finalStatus },
  });

  // Cache invalidation
  if (campaign?.userId) {
    const ranges = ["today", "week", "month"];
    ranges.forEach(range => cache.del(`dashboard:${campaign.userId}:${range}`));
    const keys = cache.keys();
    keys.forEach(key => {
      if (key.startsWith(`dashboard:${campaign.userId}:`)) cache.del(key);
    });
    console.log(`🔥 Cache invalidated for user ${campaign.userId}`);
  }

  console.log(`Campaign ${campaignId} status → ${finalStatus}`);
}