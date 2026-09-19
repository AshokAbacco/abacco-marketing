// src/services/inboundProcessor.service.js
//
// Looks at every NEW incoming email found by the IMAP sync and decides:
//
//   1. Is it a bounce (delivery failure)?
//        → record it, mark the recipient, suppress bad addresses,
//          pause the sending account if its bounce rate spikes
//   2. Is it an automatic reply (out-of-office etc.)?
//        → ignore (it must not stop follow-ups)
//   3. Is it a reply to one of our campaign emails?
//        → record it, mark the recipient(s) as replied (follow-ups stop),
//          and handle "remove me" / mailto-unsubscribe requests
//
// Everything here is idempotent: processing the same message twice has no
// extra effect (unique (accountId, messageId) on the event tables).

import prisma from "../prismaClient.js";
import {
  FEATURES,
  normalizeEmail,
  suppressEmail,
} from "./suppression.service.js";
import { syncReplyToCrm } from "./crm.service.js";
import { classifyReply } from "./replyClassifier.service.js";
import { applyReplyAutomation } from "./automation.service.js";

/* ── Configuration ─────────────────────────────────────────────────────── */

const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const SOFT_BOUNCE_LIMIT = num("SOFT_BOUNCE_LIMIT", 3); // soft bounces in 30 days → suppress
const SOFT_BOUNCE_WINDOW_DAYS = num("SOFT_BOUNCE_WINDOW_DAYS", 30);
const PAUSE_MIN_BAD = num("BOUNCE_PAUSE_MIN_COUNT", 5); // hard+block bounces in 24h …
const PAUSE_RATE = num("BOUNCE_PAUSE_RATE", 0.08); // … AND at least this share of sends
const PAUSE_HOURS = num("ACCOUNT_PAUSE_HOURS", 24);
const REPLY_MATCH_DAYS = num("REPLY_MATCH_DAYS", 45);
const REPLY_UNSUB_MODE = String(
  process.env.REPLY_UNSUBSCRIBE_MODE || "review",
).toLowerCase(); // review | auto

const CAMPAIGN_ID_RE = /<?campaign-(\d+)-(\d+)@[^>\s]+>?/i;
const CAMPAIGN_ID_RE_G = /<?campaign-(\d+)-(\d+)@[^>\s]+>?/gi;
const CAMPAIGN_HDR_RE = /X-Abacco-Campaign:\s*(\d+)-(\d+)/i;

const DAEMON_FROM_RE =
  /^(mailer-daemon|mail-daemon|mailerdaemon|postmaster|mail delivery (subsystem|system))@?/i;
const BOUNCE_SUBJECT_RE =
  /(undeliver(able|ed)|delivery status notification \((failure|delay)\)|mail delivery (failed|failure|subsystem)|returned mail|failure notice|delivery (has )?failed|could not be delivered|message not delivered|delivery incomplete|non[- ]?delivery)/i;

const AUTO_SUBJECT_RE =
  /^\s*(auto(matic)?[\s_-]*(reply|response|antwort)|out of (the )?office|autoreply|abwesenheit|réponse automatique|respuesta automática|risposta automatica|ooo\b)/i;

// Explicit opt-out phrases in the NEW part of a reply (quoted text removed).
const OPT_OUT_RE =
  /\b(unsubscribe|remove me|remove my (email|address|name)|take me off|opt[\s-]?out|stop (emailing|sending|contacting)|do not (contact|email|mail) me|don'?t (contact|email|mail) me|no more emails?|delete my (email|address|data))\b/i;

/* ── Small helpers ─────────────────────────────────────────────────────── */

const firstAddress = (field) => field?.value?.[0]?.address || "";

function headerText(parsed, name) {
  const v = parsed.headers?.get?.(name);
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "value" in v) return String(v.value ?? "");
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function collectReferencedIds(parsed) {
  const out = [];
  const push = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(push);
    else
      String(v)
        .split(/\s+/)
        .forEach((s) => s && out.push(s));
  };
  push(parsed.inReplyTo);
  push(parsed.references);
  return out;
}

function parseCampaignRef(str) {
  const m = String(str || "").match(CAMPAIGN_ID_RE);
  return m ? { campaignId: Number(m[1]), recipientId: Number(m[2]) } : null;
}

/** The new text a person typed, without the quoted thread below it. */
export function extractNewReplyText(parsed) {
  let text = parsed.text || "";
  if (!text && parsed.html) {
    text = String(parsed.html)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n");
  }
  const lines = text.replace(/\r/g, "").split("\n");
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^On .{4,200}wrote:?$/i.test(t)) break; // Gmail / Apple
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(t)) break; // Outlook
    if (/^_{8,}$/.test(t)) break; // Outlook web separator
    if (/^From:\s.+/i.test(t) && kept.length > 0) break; // Outlook header block
    if (/^Le .{4,200} a écrit\s?:?$/i.test(t)) break; // French
    if (/^Am .{4,200} schrieb .{0,120}:?$/i.test(t)) break; // German
    if (t.startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim().slice(0, 4000);
}

export function isAutoReply(parsed) {
  const autoSubmitted = headerText(parsed, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (
    parsed.headers?.has?.("x-autoreply") ||
    parsed.headers?.has?.("x-autorespond")
  )
    return true;
  const precedence = headerText(parsed, "precedence").toLowerCase();
  if (["auto_reply", "auto-reply", "bulk", "junk", "list"].includes(precedence))
    return true;
  if (headerText(parsed, "x-autogenerated").toLowerCase().includes("reply"))
    return true;
  return AUTO_SUBJECT_RE.test(parsed.subject || "");
}

/* ══════════════════════════════════════════════════════════════════════════
   BOUNCES
══════════════════════════════════════════════════════════════════════════ */

export function looksLikeBounce(parsed) {
  const from = (
    firstAddress(parsed.from) ||
    parsed.from?.text ||
    ""
  ).toLowerCase();
  const fromName = (parsed.from?.value?.[0]?.name || "").toLowerCase();
  const ct = parsed.headers?.get?.("content-type");
  const reportType = String(ct?.params?.["report-type"] || "").toLowerCase();

  if (
    ct?.value === "multipart/report" &&
    reportType.includes("delivery-status")
  )
    return true;
  if (parsed.headers?.has?.("x-failed-recipients")) return true;
  const daemon = DAEMON_FROM_RE.test(from) || DAEMON_FROM_RE.test(fromName);
  if (daemon && BOUNCE_SUBJECT_RE.test(parsed.subject || "")) return true;
  if (
    daemon &&
    (parsed.attachments || []).some((a) =>
      /delivery-status/i.test(a.contentType || ""),
    )
  )
    return true;
  return false;
}

/** Parse message/delivery-status blocks into per-recipient results. */
export function parseDeliveryStatus(text) {
  const results = [];
  if (!text) return results;
  // Unfold continuation lines, then split into blank-line separated groups.
  const unfolded = String(text)
    .replace(/\r/g, "")
    .replace(/\n[ \t]+/g, " ");
  for (const block of unfolded.split(/\n\s*\n/)) {
    const get = (name) => {
      const m = block.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
      return m ? m[1].trim() : null;
    };
    const finalRcpt = get("Final-Recipient") || get("Original-Recipient");
    if (!finalRcpt) continue;
    const address = finalRcpt.includes(";")
      ? finalRcpt.split(";").pop().trim()
      : finalRcpt;
    results.push({
      email: address.replace(/^<|>$/g, ""),
      action: (get("Action") || "").toLowerCase(),
      status: (get("Status") || "").match(/\d\.\d{1,3}\.\d{1,3}/)?.[0] || null,
      diagnostic: get("Diagnostic-Code"),
    });
  }
  return results;
}

const HARD_TEXT_RE =
  /(does ?n[o']t exist|user unknown|no such (user|mailbox|recipient)|address not found|recipient address rejected|invalid (recipient|mailbox|address)|mailbox (unavailable|not found)|unknown (user|recipient)|domain (not found|does not exist)|nxdomain|couldn'?t be found|account (has been )?disabled|account.*(inactive|deactivated))/i;
const SOFT_TEXT_RE =
  /(mailbox (is )?full|over ?quota|quota exceeded|temporar(y|ily)|try again later|rate limit|too many|deferred|greylist)/i;
const BLOCK_TEXT_RE =
  /(spam|blocked|blacklist|block ?list|rejected (due to|for) policy|policy (reasons|violation)|reputation|not authori[sz]ed|5\.7\.\d)/i;

/**
 * hard  = the address is bad (suppress now)
 * soft  = temporary problem (suppress after repeated failures)
 * block = the receiving server refused US (spam/policy) — the address may
 *         be fine, but it counts against the sending account's health
 */
export function classifyBounce({ status, diagnostic, subject, body }) {
  const text = `${diagnostic || ""} ${subject || ""} ${body || ""}`;
  if (status) {
    const [cls, subject2, detail] = status.split(".").map(Number);
    if (cls === 4) return "soft";
    if (cls === 5) {
      if (subject2 === 7) return "block";
      if (subject2 === 2 && detail === 2) return "soft"; // mailbox full
      if (subject2 === 1 || subject2 === 4) return "hard"; // bad address / routing
      if (subject2 === 2 && detail === 1) return "hard"; // mailbox disabled
      if (subject2 === 3 || subject2 === 5) return "soft"; // system / protocol
      if (BLOCK_TEXT_RE.test(text)) return "block";
      if (SOFT_TEXT_RE.test(text)) return "soft";
      return "hard";
    }
  }
  if (HARD_TEXT_RE.test(text)) return "hard";
  if (BLOCK_TEXT_RE.test(text)) return "block";
  return "soft"; // unknown → the cautious choice
}

function attachmentText(parsed, typeRe) {
  return (parsed.attachments || [])
    .filter((a) => typeRe.test(a.contentType || ""))
    .map((a) =>
      Buffer.isBuffer(a.content)
        ? a.content.toString("utf8")
        : String(a.content || ""),
    )
    .join("\n\n");
}

async function handleBounce({ account, parsed, messageId, rawSource }) {
  const accountId = Number(account.id);
  const bodyText = String(parsed.text || "").slice(0, 20_000);
  const raw = rawSource
    ? rawSource.toString("utf8", 0, Math.min(rawSource.length, 300_000))
    : "";

  // Which campaign email bounced? Our Message-ID / header appears in the
  // returned original (attached or quoted).
  const refMatch =
    raw.match(CAMPAIGN_HDR_RE) ||
    raw.match(CAMPAIGN_ID_RE) ||
    bodyText.match(CAMPAIGN_HDR_RE) ||
    bodyText.match(CAMPAIGN_ID_RE);
  let linked = null;
  if (refMatch) {
    linked = await prisma.campaignRecipient.findFirst({
      where: { id: Number(refMatch[2]), campaignId: Number(refMatch[1]) },
      select: { id: true, campaignId: true, email: true },
    });
  }

  // Which address(es) failed?
  // mailparser usually merges the message/delivery-status section into the
  // text body; some servers attach it. Try all three places.
  let entries = parseDeliveryStatus(attachmentText(parsed, /delivery-status/i));
  if (!entries.length) entries = parseDeliveryStatus(String(parsed.text || ""));
  if (!entries.length && raw) entries = parseDeliveryStatus(raw);
  if (!entries.length) {
    const failed = headerText(parsed, "x-failed-recipients");
    entries = failed
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((email) => ({
        email,
        action: "failed",
        status: bodyText.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/)?.[1] || null,
        diagnostic: null,
      }));
  }
  if (!entries.length && linked) {
    entries = [
      {
        email: linked.email,
        action: "failed",
        status: bodyText.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/)?.[1] || null,
        diagnostic: null,
      },
    ];
  }

  const handled = [];
  for (const entry of entries) {
    if (entry.action && !["failed", ""].includes(entry.action)) continue; // delayed/delivered/relayed
    const email = normalizeEmail(entry.email);
    if (!email) continue;

    const type = classifyBounce({
      status: entry.status,
      diagnostic: entry.diagnostic,
      subject: parsed.subject,
      body: bodyText.slice(0, 2000),
    });

    const recipient =
      linked && linked.email.toLowerCase() === email ? linked : null;
    // One notification can list several addresses; keep the event key unique.
    const eventKey = entries.length > 1 ? `${messageId}#${email}` : messageId;

    try {
      await prisma.emailBounce.create({
        data: {
          email,
          accountId,
          type,
          campaignId: recipient?.campaignId ?? linked?.campaignId ?? null,
          recipientId: recipient?.id ?? null,
          statusCode: entry.status,
          diagnostic: entry.diagnostic
            ? String(entry.diagnostic).slice(0, 500)
            : null,
          messageId: eventKey.slice(0, 500),
        },
      });
    } catch (err) {
      if (err.code === "P2002") continue; // already processed
      throw err;
    }

    // Mark the specific recipient row(s) this account sent to that address.
    const since = new Date(Date.now() - REPLY_MATCH_DAYS * 86_400_000);
    await prisma.campaignRecipient.updateMany({
      where: recipient
        ? { id: recipient.id }
        : {
            email,
            status: "sent",
            bouncedAt: null,
            sentAt: { gte: since },
            OR: [{ accountId }, { sentFromEmail: account.email }],
          },
      data: { bouncedAt: new Date(), bounceType: type },
    });

    if (type === "hard") {
      await suppressEmail({
        email,
        reason: "hard_bounce",
        source: "bounce",
        note:
          [entry.status, entry.diagnostic]
            .filter(Boolean)
            .join(" ")
            .slice(0, 300) || null,
        campaignId: recipient?.campaignId ?? null,
        accountId,
      });
    } else if (type === "soft") {
      const recent = await prisma.emailBounce.count({
        where: {
          email,
          type: "soft",
          createdAt: {
            gte: new Date(Date.now() - SOFT_BOUNCE_WINDOW_DAYS * 86_400_000),
          },
        },
      });
      if (recent >= SOFT_BOUNCE_LIMIT) {
        await suppressEmail({
          email,
          reason: "soft_bounce",
          source: "bounce",
          note: `${recent} temporary failures in ${SOFT_BOUNCE_WINDOW_DAYS} days`,
          accountId,
        });
      }
    }

    handled.push({ email, type });
  }

  if (handled.some((h) => h.type === "hard" || h.type === "block")) {
    await evaluateAccountHealth(account);
  }
  return handled;
}

/* ══════════════════════════════════════════════════════════════════════════
   ACCOUNT HEALTH / AUTO-PAUSE
══════════════════════════════════════════════════════════════════════════ */

export async function getAccountHealth(accountId, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [sent24, bad24] = await Promise.all([
    prisma.campaignRecipient.count({
      where: { accountId, status: "sent", sentAt: { gte: since } },
    }),
    prisma.emailBounce.count({
      where: {
        accountId,
        type: { in: ["hard", "block"] },
        createdAt: { gte: since },
      },
    }),
  ]);
  const rate = bad24 / Math.max(sent24, 1);
  return { sent24, bad24, rate };
}

/* Listeners (the campaign engine) are told when a pause changes in this
   process, so a pause takes effect before the very next email. */
const pauseListeners = new Set();
export function onAccountPauseChange(fn) {
  pauseListeners.add(fn);
  return () => pauseListeners.delete(fn);
}
function notifyPauseChange(accountId) {
  for (const fn of pauseListeners) {
    try {
      fn(accountId);
    } catch {
      /* listener errors must not break callers */
    }
  }
}

/** Pause sending from an account (no-op if already paused). */
export async function pauseAccount(accountId, reason, hours = PAUSE_HOURS) {
  const now = new Date();
  const res = await prisma.emailAccount.updateMany({
    where: { id: accountId, sendingPausedAt: null },
    data: {
      sendingPausedAt: now,
      sendingPausedReason: String(reason).slice(0, 300),
      sendingPausedUntil:
        hours > 0 ? new Date(now.getTime() + hours * 3_600_000) : null,
    },
  });
  notifyPauseChange(accountId);
  if (res.count)
    console.warn(`⏸️  Sending paused for account ${accountId}: ${reason}`);
  return res.count > 0;
}

export async function resumeAccount(accountId) {
  const res = await prisma.emailAccount.updateMany({
    where: { id: accountId },
    data: {
      sendingPausedAt: null,
      sendingPausedReason: null,
      sendingPausedUntil: null,
    },
  });
  notifyPauseChange(accountId);
  return res.count > 0;
}

/** Auto-resume accounts whose pause has expired. Called by the worker. */
export async function resumeExpiredPauses() {
  const res = await prisma.emailAccount.updateMany({
    where: {
      sendingPausedAt: { not: null },
      sendingPausedUntil: { lte: new Date() },
    },
    data: {
      sendingPausedAt: null,
      sendingPausedReason: null,
      sendingPausedUntil: null,
    },
  });
  if (res.count) {
    notifyPauseChange(null); // unknown which — clear all cached states
    console.log(`▶️  Auto-resumed ${res.count} paused account(s)`);
  }
  return res.count;
}

async function evaluateAccountHealth(account) {
  const { sent24, bad24, rate } = await getAccountHealth(Number(account.id));
  if (bad24 >= PAUSE_MIN_BAD && rate >= PAUSE_RATE) {
    await pauseAccount(
      Number(account.id),
      `High bounce rate: ${bad24} failed of ${sent24} sent in 24h (${(rate * 100).toFixed(1)}%)`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   REPLIES
══════════════════════════════════════════════════════════════════════════ */

async function findRepliedRecipient({
  account,
  parsed,
  fromEmail,
  receivedAt,
}) {
  // 1) Exact: the reply references one of our Message-IDs.
  for (const id of collectReferencedIds(parsed)) {
    const ref = parseCampaignRef(id);
    if (!ref) continue;
    const row = await prisma.campaignRecipient.findFirst({
      where: { id: ref.recipientId, campaignId: ref.campaignId },
      select: { id: true, campaignId: true, email: true, sentAt: true },
    });
    if (row) return { row, matchedBy: "header" };
  }

  // 2) Fallback: the sender is someone this mailbox emailed recently.
  if (!fromEmail) return null;
  const since = new Date(receivedAt.getTime() - REPLY_MATCH_DAYS * 86_400_000);
  const row = await prisma.campaignRecipient.findFirst({
    where: {
      email: fromEmail,
      status: "sent",
      sentAt: { gte: since, lte: receivedAt },
      OR: [{ accountId: Number(account.id) }, { sentFromEmail: account.email }],
    },
    orderBy: { sentAt: "desc" },
    select: { id: true, campaignId: true, email: true, sentAt: true },
  });
  return row ? { row, matchedBy: "address" } : null;
}

async function handleReply({
  account,
  parsed,
  messageId,
  conversationId,
  receivedAt,
}) {
  const fromEmail = normalizeEmail(firstAddress(parsed.from));
  const match = await findRepliedRecipient({
    account,
    parsed,
    fromEmail,
    receivedAt,
  });
  if (!match) return null;

  const { row, matchedBy } = match;
  const email = row.email.toLowerCase();
  const newText = extractNewReplyText(parsed);
  const mailtoUnsub = /^\s*unsubscribe\s*$/i.test(parsed.subject || "");
  const optOut = mailtoUnsub || OPT_OUT_RE.test(newText);
  const intent = optOut ? "unsubscribe_request" : "reply";

  let reviewStatus = null;
  if (optOut) {
    reviewStatus =
      mailtoUnsub || REPLY_UNSUB_MODE === "auto" ? "suppressed" : "pending";
  }

  // Phase 3: classify (rules, optionally AI). Opt-outs are always "unsubscribe".
  const classification = optOut
    ? { category: "unsubscribe", confidence: 1, source: "rules" }
    : await classifyReply({ subject: parsed.subject || "", text: newText });

  let replyEvent;
  try {
    replyEvent = await prisma.replyEvent.create({
      data: {
        email,
        fromEmail,
        accountId: Number(account.id),
        campaignId: row.campaignId,
        recipientId: row.id,
        messageId: String(messageId).slice(0, 500),
        conversationId: conversationId || null,
        subject: (parsed.subject || "").slice(0, 300),
        snippet: newText.replace(/\s+/g, " ").slice(0, 300),
        intent,
        matchedBy,
        receivedAt,
        reviewStatus,
        category: classification.category,
        categorySource: classification.source,
        confidence: classification.confidence,
      },
    });
  } catch (err) {
    if (err.code === "P2002") return null; // already processed
    throw err;
  }

  // Every email this mailbox sent to this person before the reply is now
  // "replied" — the original and any follow-ups already sent.
  await prisma.campaignRecipient.updateMany({
    where: { id: row.id, repliedAt: null },
    data: { repliedAt: receivedAt },
  });
  const since = new Date(receivedAt.getTime() - REPLY_MATCH_DAYS * 86_400_000);
  await prisma.campaignRecipient.updateMany({
    where: {
      email,
      repliedAt: null,
      sentAt: { gte: since, lte: receivedAt },
      OR: [{ accountId: Number(account.id) }, { sentFromEmail: account.email }],
    },
    data: { repliedAt: receivedAt },
  });

  // Queued follow-ups to this person stop right away. (Recipient addresses
  // are stored lower-case, so this uses the (email, sentAt) index.)
  await prisma.$executeRaw`
    UPDATE "CampaignRecipient" r
    SET "status" = 'skipped', "error" = 'Replied', "updatedAt" = NOW()
    FROM "Campaign" c
    WHERE r."email" = ${email}
      AND r."status" = 'pending'
      AND r."campaignId" = c."id"
      AND c."sendType" = 'followup'
  `;

  // CRM: make sure the person exists as a contact (owned by this mailbox's
  // owner). A CRM failure must never undo reply handling.
  try {
    const crm = await syncReplyToCrm({
      email,
      fromName: parsed.from?.value?.[0]?.name || null,
      account,
      receivedAt,
    });
    // Phase 3: move the deal / create a task / notify the owner.
    if (crm?.contact)
      await applyReplyAutomation({ replyEvent, contact: crm.contact });
  } catch (err) {
    if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(err?.code))
      throw err;
    console.error(
      `CRM automation for reply from ${email} failed:`,
      err.message,
    );
  }

  if (reviewStatus === "suppressed") {
    await suppressEmail({
      email,
      reason: mailtoUnsub ? "unsubscribe" : "reply_request",
      source: mailtoUnsub ? "mailto" : "reply",
      note: mailtoUnsub ? null : newText.replace(/\s+/g, " ").slice(0, 200),
      campaignId: row.campaignId,
      accountId: Number(account.id),
    });
  }

  return {
    email,
    intent,
    matchedBy,
    reviewStatus,
    category: classification.category,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   ENTRY POINT
══════════════════════════════════════════════════════════════════════════ */

/**
 * Called by the IMAP sync for each newly stored RECEIVED message.
 * Never throws for bad input; DB errors propagate so the sync can stop.
 *
 * @returns {Promise<{ kind: "bounce"|"auto_reply"|"reply"|"none", detail?: any }>}
 */
export async function processInboundMessage({
  account,
  parsed,
  messageId,
  conversationId,
  receivedAt,
  rawSource,
}) {
  if (!parsed || !account) return { kind: "none" };
  const fromEmail = normalizeEmail(firstAddress(parsed.from));
  if (fromEmail && fromEmail === String(account.email).toLowerCase())
    return { kind: "none" };

  if (looksLikeBounce(parsed)) {
    if (!FEATURES.bounceHandling) return { kind: "bounce", detail: "disabled" };
    const detail = await handleBounce({
      account,
      parsed,
      messageId,
      rawSource,
    });
    return { kind: "bounce", detail };
  }

  if (!FEATURES.replyDetection) return { kind: "none" };

  if (isAutoReply(parsed)) return { kind: "auto_reply" };

  const detail = await handleReply({
    account,
    parsed,
    messageId,
    conversationId,
    receivedAt:
      receivedAt instanceof Date && !Number.isNaN(receivedAt.getTime())
        ? receivedAt
        : new Date(),
  });
  return detail ? { kind: "reply", detail } : { kind: "none" };
}

// Exposed for tests.
export const __test = {
  CAMPAIGN_ID_RE_G,
  parseCampaignRef,
  collectReferencedIds,
};
