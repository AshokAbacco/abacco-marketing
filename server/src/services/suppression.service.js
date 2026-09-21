// src/services/suppression.service.js
//
// Company-wide do-not-contact list + signed unsubscribe links.
//
// Used by:
//   • campaign engine   — skip suppressed recipients before sending
//   • unsubscribe route — record opt-outs from links / one-click buttons
//   • inbound processor — record hard bounces and "remove me" replies
//   • deliverability admin API

import crypto from "crypto";
import prisma from "../prismaClient.js";

/* ── Configuration ─────────────────────────────────────────────────────── */

const flag = (name, fallback = true) => {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !["false", "0", "off", "no"].includes(String(v).toLowerCase());
};

export const FEATURES = {
  unsubscribe:     flag("FEATURE_UNSUBSCRIBE"),
  replyDetection:  flag("FEATURE_REPLY_DETECTION"),
  bounceHandling:  flag("FEATURE_BOUNCE_HANDLING"),
  suppression:     flag("FEATURE_SUPPRESSION"),
  textAlternative: flag("FEATURE_TEXT_ALTERNATIVE"),
};

export const SUPPRESSION_REASONS = [
  "unsubscribe", "reply_request", "hard_bounce", "soft_bounce", "manual", "import",
];

const PUBLIC_API_URL = String(process.env.PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
const UNSUB_SECRET   = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || "";
const FOOTER_TEXT    = process.env.UNSUBSCRIBE_FOOTER_TEXT || "Not interested? Unsubscribe";

let warnedNoUrl = false;
function publicUrlConfigured() {
  if (PUBLIC_API_URL) return true;
  if (!warnedNoUrl) {
    warnedNoUrl = true;
    console.warn(
      "⚠️  PUBLIC_API_URL is not set — unsubscribe LINKS are disabled " +
      "(the mailto unsubscribe header is still added). Set it to your public API URL."
    );
  }
  return false;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function normalizeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

export function maskEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "your address";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"•".repeat(Math.max(1, Math.min(6, local.length - head.length)))}@${domain}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Suppression cache ─────────────────────────────────────────────────────
   The engine checks every recipient. Positive AND negative answers are
   cached briefly; adding/removing an address clears its entry in this
   process, and the short TTL bounds staleness in the other process.     */
const CACHE_TTL_MS = 30_000;
const cache = new Map(); // email → { suppressed: bool, reason, at }

function cacheGet(email) {
  const hit = cache.get(email);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  if (hit) cache.delete(email);
  return null;
}
function cacheSet(email, value) {
  if (cache.size > 50_000) cache.clear();
  cache.set(email, { ...value, at: Date.now() });
}

/**
 * @returns {Promise<{ suppressed: boolean, reason?: string }>}
 */
export async function getSuppression(email) {
  const e = normalizeEmail(email);
  if (!e || !FEATURES.suppression) return { suppressed: false };
  const hit = cacheGet(e);
  if (hit) return hit;
  const row = await prisma.suppressedEmail.findUnique({
    where:  { email: e },
    select: { reason: true },
  });
  const value = row ? { suppressed: true, reason: row.reason } : { suppressed: false };
  cacheSet(e, value);
  return value;
}

/**
 * Add an address to the do-not-contact list (idempotent — the first
 * reason recorded is kept). Also stamps unsubscribedAt / bounced rows.
 * @returns {Promise<{ created: boolean, email: string } | null>}
 */
export async function suppressEmail({
  email, reason, source = null, note = null,
  campaignId = null, accountId = null, addedById = null,
}) {
  const e = normalizeEmail(email);
  if (!e) return null;
  if (!SUPPRESSION_REASONS.includes(reason)) throw new Error(`Invalid suppression reason: ${reason}`);

  let created = false;
  try {
    await prisma.suppressedEmail.create({
      data: {
        email: e, reason, source,
        note: note ? String(note).slice(0, 500) : null,
        campaignId, accountId, addedById,
      },
    });
    created = true;
  } catch (err) {
    if (err.code !== "P2002") throw err; // already suppressed
  }
  cacheSet(e, { suppressed: true, reason });

  if (reason === "unsubscribe" || reason === "reply_request") {
    await prisma.campaignRecipient.updateMany({
      where: { email: e, unsubscribedAt: null, status: "sent" },
      data:  { unsubscribedAt: new Date() },
    });
  }

  // Anything still queued for this person must not go out.
  await prisma.campaignRecipient.updateMany({
    where: { email: e, status: "pending" },
    data:  { status: "skipped", error: `Suppressed: ${reason}`, updatedAt: new Date() },
  });

  return { created, email: e };
}

export async function unsuppressEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return false;
  const res = await prisma.suppressedEmail.deleteMany({ where: { email: e } });
  cache.delete(e);
  return res.count > 0;
}

export function clearSuppressionCache() {
  cache.clear();
}

/**
 * Mark every pending recipient of a campaign that is on the suppression
 * list as "skipped" — one statement, run when a campaign starts.
 */
export async function skipSuppressedRecipients(campaignId) {
  if (!FEATURES.suppression) return 0;
  return prisma.$executeRaw`
    UPDATE "CampaignRecipient" r
    SET "status" = 'skipped',
        "error" = 'Suppressed: ' || s."reason",
        "updatedAt" = NOW()
    FROM "SuppressedEmail" s
    WHERE r."campaignId" = ${campaignId}
      AND r."status" = 'pending'
      AND s."email" = lower(r."email")
  `;
}

/* ── Signed unsubscribe tokens ─────────────────────────────────────────────
   token = base64url(JSON{e,c,r}) + "." + base64url(HMAC-SHA256)[0..22]
   The email is inside the token so the link keeps working even after the
   campaign (and its recipient rows) are cleaned up.                      */

function sign(payload) {
  return crypto.createHmac("sha256", UNSUB_SECRET).update(payload).digest("base64url").slice(0, 22);
}

export function createUnsubscribeToken({ email, campaignId = null, recipientId = null }) {
  if (!UNSUB_SECRET) throw new Error("UNSUBSCRIBE_SECRET / JWT_SECRET is not set");
  const payload = Buffer.from(
    JSON.stringify({ e: String(email).toLowerCase(), c: campaignId, r: recipientId })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** @returns {{ email: string, campaignId: number|null, recipientId: number|null } | null} */
export function verifyUnsubscribeToken(token) {
  if (!UNSUB_SECRET || typeof token !== "string" || token.length > 1024) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const email = normalizeEmail(data.e);
    if (!email) return null;
    return {
      email,
      campaignId:  Number.isInteger(data.c) ? data.c : null,
      recipientId: Number.isInteger(data.r) ? data.r : null,
    };
  } catch {
    return null;
  }
}

/**
 * Everything the mailer needs to make an email unsubscribable.
 * @returns {{ headers: object, footerHtml: string, url: string|null }}
 */
export function buildUnsubscribeParts({ email, campaignId, recipientId, fromEmail }) {
  if (!FEATURES.unsubscribe) return { headers: {}, footerHtml: "", url: null };

  const entries = [];
  let url = null;

  if (publicUrlConfigured() && UNSUB_SECRET) {
    url = `${PUBLIC_API_URL}/u/${createUnsubscribeToken({ email, campaignId, recipientId })}`;
    entries.push(`<${url}>`);
  }
  if (fromEmail) {
    entries.push(`<mailto:${fromEmail}?subject=unsubscribe>`);
  }

  const headers = {};
  if (entries.length) headers["List-Unsubscribe"] = entries.join(", ");
  // RFC 8058 one-click: only valid together with an https URL.
  if (url && url.startsWith("https://")) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";

  const footerHtml = url
    ? `<div style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#8a8a8a;">` +
      `<a href="${escapeHtml(url)}" style="color:#8a8a8a;text-decoration:underline;" target="_blank" rel="noopener">${escapeHtml(FOOTER_TEXT)}</a>` +
      `</div>`
    : "";

  return { headers, footerHtml, url };
}
