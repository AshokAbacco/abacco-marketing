// src/services/sendingLimits.service.js
//
// Per-mailbox daily caps and warm-up (Phase 4).
//
// WHY: providers judge each mailbox on its own behaviour. A brand-new
// mailbox sending 200 emails on day one gets flagged; the same mailbox
// ramping 10 → 15 → 20 … looks like a person. This module decides how many
// emails each mailbox may send today and counts what it has sent.
//
// The "day" is the same 5 PM → 5 PM window the engine already uses for the
// company-wide limit, so the numbers line up.

import prisma from "../prismaClient.js";
import { getSetting, saveSetting } from "./automation.service.js";

/* ── The sending day ───────────────────────────────────────────────────── */

const SEND_DAY_TZ = process.env.SEND_DAY_TIMEZONE || "Asia/Kolkata";
const SEND_DAY_RESET_HOUR = Number(process.env.SEND_DAY_RESET_HOUR) || 17; // 5 PM
const DAY_MS = 86_400_000;

/* BUG FIXED — "Daily Limit (All Campaigns)" stayed at 0 while emails were
   being sent.

   The old version built a "fake" Date from toLocaleString() and then called
   setHours() in the SERVER's own time zone. The result depended on the
   machine's time zone: on a UTC server (Render worker) the 5 PM IST day was
   stored as 17:00 UTC, on an IST machine as 11:30 UTC. The worker WROTE the
   per-mailbox counter under one key and the API READ it under the other
   (AccountDailySend is looked up with day = exact value), so the UI always
   found no row → "Gmail: 0 / 300 sent".

   Now the start of the sending day is the REAL instant of 5 PM in
   SEND_DAY_TIMEZONE, computed with Intl — identical on every machine no
   matter what TZ it runs in.                                              */
const tzParts = new Intl.DateTimeFormat("en-US", {
  timeZone: SEND_DAY_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Offset (ms) of SEND_DAY_TZ from UTC at the given instant. */
function tzOffsetMs(date) {
  const p = {};
  for (const x of tzParts.formatToParts(date)) p[x.type] = x.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Start of the current sending window (a real, time-zone-independent instant). */
export function getSendingDayStart(now = new Date()) {
  const t = now.getTime();
  const off = tzOffsetMs(now);
  const wall = new Date(t + off); // its UTC fields = wall clock in SEND_DAY_TZ
  let resetWall = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    SEND_DAY_RESET_HOUR,
  );
  if (t + off < resetWall) resetWall -= DAY_MS;
  let start = resetWall - off;
  // Zones with daylight saving: use the offset valid AT the reset moment.
  const offAtStart = tzOffsetMs(new Date(start));
  if (offAtStart !== off) start = resetWall - offAtStart;
  return new Date(start);
}

/** Milliseconds until the next window opens. */
export function msUntilNextSendingDay(now = new Date()) {
  const start = getSendingDayStart(now).getTime();
  // A moment safely inside the next window → its start is the next reset.
  const next = getSendingDayStart(new Date(start + DAY_MS + 3 * 3_600_000));
  return Math.max(1000, next.getTime() - now.getTime());
}

/* ── Settings ──────────────────────────────────────────────────────────── */

export const DEFAULT_SENDING_LIMITS = Object.freeze({
  /// Used when a provider isn't listed below
  defaultDailyCap: 150,
  /// Caps for providers WITHOUT a fixed limit (see PROVIDER_DAILY_LIMITS,
  /// which always win for gmail / gsuite / yahoo / rediff). Only used when
  /// MAILBOX_DAILY_CAPS=true.
  providerCaps: {
    outlook: 100,
    office365: 400,
    zoho: 150,
    amazon: 500,
    custom: 200,
  },
  warmup: {
    startCap: 10,
    incrementPerDay: 5,
    targetCap: 100,
  },
  /// Stop a mailbox reaching its cap from being tried again for this long
  enabled: true,
});

export async function getSendingLimits() {
  const stored = await getSetting("sendingLimits", null);
  const base = structuredClone(DEFAULT_SENDING_LIMITS);
  if (!stored || typeof stored !== "object") return base;
  return {
    enabled:
      stored.enabled !== undefined ? Boolean(stored.enabled) : base.enabled,
    defaultDailyCap:
      Number(stored.defaultDailyCap) > 0
        ? Math.round(Number(stored.defaultDailyCap))
        : base.defaultDailyCap,
    providerCaps: { ...base.providerCaps, ...(stored.providerCaps || {}) },
    warmup: { ...base.warmup, ...(stored.warmup || {}) },
  };
}

export function validateSendingLimits(input) {
  if (!input || typeof input !== "object")
    return { error: "Settings must be an object" };
  const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max)
      return { error: `${label} must be ${min}–${max}` };
    return { value: Math.round(n) };
  };
  const cap = int(input.defaultDailyCap, 1, 100_000, "Default daily cap");
  if (cap.error) return cap;

  const providerCaps = {};
  for (const [k, v] of Object.entries(input.providerCaps || {})) {
    const r = int(v, 1, 100_000, `Cap for ${k}`);
    if (r.error) return r;
    providerCaps[String(k).toLowerCase().slice(0, 30)] = r.value;
  }
  const start = int(input.warmup?.startCap, 1, 10_000, "Warm-up start");
  if (start.error) return start;
  const inc = int(
    input.warmup?.incrementPerDay,
    1,
    10_000,
    "Warm-up daily increase",
  );
  if (inc.error) return inc;
  const target = int(input.warmup?.targetCap, 1, 100_000, "Warm-up target");
  if (target.error) return target;
  if (target.value < start.value)
    return { error: "Warm-up target must be at least the start value" };

  return {
    value: {
      enabled: Boolean(input.enabled),
      defaultDailyCap: cap.value,
      providerCaps,
      warmup: {
        startCap: start.value,
        incrementPerDay: inc.value,
        targetCap: target.value,
      },
    },
  };
}

export async function saveSendingLimits(value, userId) {
  await saveSetting("sendingLimits", value, userId);
  capCache.clear();
}

/* ── Provider daily limits (hard ceilings) ─────────────────────────────────
   Emails per mailbox per sending day, by provider. These are business rules,
   not tuning knobs: a mailbox never sends more than this in one day, for
   normal AND follow-up campaigns combined. A manual per-mailbox cap or
   warm-up (when MAILBOX_DAILY_CAPS=true) can only LOWER it.

   The count resets with the sending day (SEND_DAY_RESET_HOUR in
   SEND_DAY_TIMEZONE — 5 PM IST by default). Unsent emails simply stay
   pending and go out after the reset.                                   */
export const PROVIDER_DAILY_LIMITS = Object.freeze({
  gmail: 300, // free Gmail (@gmail.com / @googlemail.com)
  gsuite: 1500, // Google Workspace (G Suite) on a company domain
  yahoo: 50,
  rediff: 300,
});

export const PROVIDER_LABELS = Object.freeze({
  gmail: "Gmail",
  gsuite: "Google Workspace",
  yahoo: "Yahoo",
  rediff: "Rediff",
  outlook: "Outlook",
  office365: "Office 365",
  zoho: "Zoho",
  custom: "Custom",
});

const FREE_GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const YAHOO_DOMAIN_RE = /^(yahoo|ymail|rocketmail)\./;
const REDIFF_DOMAIN_RE = /(^|\.)rediffmail(pro)?\.com$|(^|\.)rediff\.com$/;

/**
 * Which provider family a mailbox belongs to, for its daily limit.
 *
 * Free Gmail and Google Workspace both connect to Google, so the stored
 * `provider` alone can't tell them apart: a Google mailbox on
 * @gmail.com / @googlemail.com is free Gmail; on any other domain it is
 * Workspace.
 * @param {{ provider?: string|null, email?: string|null }} account
 * @returns {string} gmail | gsuite | yahoo | rediff | <other provider> | custom
 */
export function detectProvider(account = {}) {
  const p = String(account.provider || "").toLowerCase().trim();
  const domain = String(account.email || "").toLowerCase().split("@")[1] || "";

  if (FREE_GMAIL_DOMAINS.has(domain)) return "gmail";
  const isGoogle =
    p.includes("gmail") ||
    p.includes("google") ||
    p.includes("gsuite") ||
    p.includes("g-suite") ||
    p.includes("workspace");
  if (isGoogle) return "gsuite";
  if (p.includes("yahoo") || YAHOO_DOMAIN_RE.test(domain)) return "yahoo";
  if (p.includes("rediff") || REDIFF_DOMAIN_RE.test(domain)) return "rediff";
  return p || "custom";
}

export function providerLabel(key) {
  return PROVIDER_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1) : "Custom");
}

/* ── Effective cap per mailbox ─────────────────────────────────────────── */

const CAP_TTL_MS = Number(process.env.ACCOUNT_CAP_CACHE_MS) || 60_000;
const capCache = new Map(); // accountId → { cap, source, ..., at }

// Manual per-mailbox caps, warm-up and the company-configurable caps for
// OTHER providers stay behind this flag (off by default). The provider
// limits above are always enforced.
export const MAILBOX_DAILY_CAPS_ENABLED =
  process.env.MAILBOX_DAILY_CAPS === "true";

/**
 * How many emails this mailbox may send today, and why.
 * @returns {{ cap: number, source: "provider"|"manual"|"warmup"|"default"|"off",
 *             providerKey: string, providerLabel: string,
 *             providerLimit: number|null, warmupDay?: number }}
 */
export function computeDailyCap(account, limits, now = new Date()) {
  const providerKey = detectProvider(account);
  const fixed = PROVIDER_DAILY_LIMITS[providerKey];
  const extrasOn = MAILBOX_DAILY_CAPS_ENABLED && limits.enabled;

  // Ceiling: the provider rule, else (only with the flag on) the
  // company-configured cap for that provider / the default.
  let ceiling = Infinity;
  let source = "off";
  if (fixed) {
    ceiling = fixed;
    source = "provider";
  } else if (extrasOn) {
    ceiling = limits.providerCaps[providerKey] || limits.defaultDailyCap;
    source = limits.providerCaps[providerKey] ? "provider" : "default";
  }

  const base = {
    providerKey,
    providerLabel: providerLabel(providerKey),
    providerLimit: fixed ?? (Number.isFinite(ceiling) ? ceiling : null),
  };

  if (!extrasOn) return { ...base, cap: ceiling, source };

  if (Number.isInteger(account.dailyCap) && account.dailyCap > 0) {
    return { ...base, cap: Math.min(account.dailyCap, ceiling), source: "manual" };
  }

  if (account.warmupEnabled) {
    const start = account.warmupStartAt ? new Date(account.warmupStartAt) : null;
    const startCap = account.warmupStartCap || limits.warmup.startCap;
    const target = Math.min(
      account.warmupTarget || limits.warmup.targetCap,
      ceiling,
    );
    const dayIndex = start
      ? Math.max(
          0,
          Math.round(
            (getSendingDayStart(now) - getSendingDayStart(start)) / DAY_MS,
          ),
        )
      : 0;
    const cap = Math.min(target, startCap + dayIndex * limits.warmup.incrementPerDay);
    return { ...base, cap: Math.max(1, cap), source: "warmup", warmupDay: dayIndex + 1 };
  }

  return { ...base, cap: ceiling, source };
}

const CAP_ACCOUNT_SELECT = Object.freeze({
  id: true,
  email: true,
  provider: true,
  dailyCap: true,
  warmupEnabled: true,
  warmupStartAt: true,
  warmupStartCap: true,
  warmupTarget: true,
});

export async function getAccountCap(accountId, { fresh = false } = {}) {
  const hit = capCache.get(accountId);
  if (!fresh && hit && Date.now() - hit.at < CAP_TTL_MS) return hit;
  const [account, limits] = await Promise.all([
    prisma.emailAccount.findUnique({
      where: { id: accountId },
      select: CAP_ACCOUNT_SELECT,
    }),
    getSendingLimits(),
  ]);
  const value = account
    ? { ...computeDailyCap(account, limits), at: Date.now() }
    : {
        cap: 0,
        source: "default",
        providerKey: "custom",
        providerLabel: "Custom",
        providerLimit: null,
        at: Date.now(),
      };
  capCache.set(accountId, value);
  return value;
}

export function invalidateCapCache(accountId) {
  if (accountId === undefined) capCache.clear();
  else capCache.delete(Number(accountId));
}

/* ── Counting today's sends ────────────────────────────────────────────────
   One AccountDailySend row per mailbox per sending day. Each send RESERVES
   its place with a single conditional UPDATE:

       UPDATE ... SET count = count + 1
       WHERE accountId = ? AND day = ? AND count < cap

   Postgres re-checks `count < cap` under the row lock, so two campaigns
   (or two worker processes) sharing a mailbox can never push it past its
   limit. If the SMTP send then fails, the reservation is given back.
   A crash between reserve and send can over-count by one — the safe side.

   Earlier sends were counted in memory and flushed every 5 s; that let
   concurrent campaigns overshoot a cap and made the API's numbers lag.   */

const COUNT_TTL_MS = 10_000;
const countCache = new Map(); // accountId → { day, count, at }
const ensuredRows = new Set(); // `${accountId}|${dayMs}` rows known to exist

/** Emails this mailbox REALLY sent (CampaignRecipient rows) since `day`. */
async function countSentSince(accountId, day) {
  return prisma.campaignRecipient.count({
    where: { accountId, status: "sent", sentAt: { gte: day } },
  });
}

async function ensureDayRow(accountId, day) {
  const key = `${accountId}|${day.getTime()}`;
  if (ensuredRows.has(key)) return;
  const exists = await prisma.accountDailySend.findUnique({
    where: { accountId_day: { accountId, day } },
    select: { id: true },
  });
  if (!exists) {
    // A new row starts from what the mailbox has ACTUALLY sent today, not 0.
    // This also carries today's sends over from rows written under the old
    // (time-zone-dependent) day key, so no mailbox exceeds its daily limit
    // on the day this fix is deployed.
    const already = await countSentSince(accountId, day).catch(() => 0);
    await prisma.accountDailySend.createMany({
      data: [{ accountId, day, count: already }],
      skipDuplicates: true,
    });
  }
  if (ensuredRows.size > 5000) ensuredRows.clear();
  ensuredRows.add(key);
}

/** Emails this mailbox has sent in the current window. */
export async function getAccountSentToday(accountId, { fresh = false } = {}) {
  const day = getSendingDayStart();
  const dayMs = day.getTime();
  const hit = countCache.get(accountId);
  if (!fresh && hit && hit.day === dayMs && Date.now() - hit.at < COUNT_TTL_MS)
    return hit.count;

  const row = await prisma.accountDailySend.findUnique({
    where: { accountId_day: { accountId, day } },
    select: { count: true },
  });
  const count = row?.count || 0;
  countCache.set(accountId, { day: dayMs, count, at: Date.now() });
  return count;
}

/**
 * Sent-today for many mailboxes (dashboards / campaign status).
 * Uses the larger of the reservation counter and the emails actually marked
 * "sent" today, so the UI can never show 0 while a mailbox is sending — even
 * if a counter row is missing or was written under an old day key.
 */
export async function getSentTodayMany(accountIds) {
  const ids = [...new Set(accountIds.map(Number).filter(Number.isInteger))];
  const out = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return out;
  const day = getSendingDayStart();
  const [rows, actual] = await Promise.all([
    prisma.accountDailySend.findMany({
      where: { accountId: { in: ids }, day },
      select: { accountId: true, count: true },
    }),
    prisma.campaignRecipient
      .groupBy({
        by: ["accountId"],
        where: { accountId: { in: ids }, status: "sent", sentAt: { gte: day } },
        _count: { _all: true },
      })
      .catch(() => []),
  ]);
  for (const r of rows) out.set(r.accountId, r.count);
  for (const r of actual) {
    const id = Number(r.accountId);
    out.set(id, Math.max(out.get(id) || 0, r._count._all));
  }
  return out;
}

/**
 * Reserve one send for this mailbox today, atomically.
 * @param {number} accountId
 * @param {number} cap   today's cap (Infinity = count only, no limit)
 * @returns {Promise<{ ok: boolean, accountId: number, day: Date, sentToday?: number }>}
 */
export async function tryReserveAccountSend(accountId, cap) {
  const day = getSendingDayStart();
  const dayMs = day.getTime();
  await ensureDayRow(accountId, day);

  const where = { accountId, day };
  if (Number.isFinite(cap)) where.count = { lt: cap };
  const r = await prisma.accountDailySend.updateMany({
    where,
    data: { count: { increment: 1 } },
  });

  const cached = countCache.get(accountId);
  if (r.count === 0) {
    // At the cap: make the pre-check see it immediately.
    countCache.set(accountId, {
      day: dayMs,
      count: Math.max(cap, cached?.day === dayMs ? cached.count : 0),
      at: Date.now(),
    });
    return { ok: false, accountId, day, sentToday: cap };
  }
  if (cached && cached.day === dayMs) cached.count += 1;
  return { ok: true, accountId, day };
}

/** Give a reservation back (the email was not sent). */
export async function releaseAccountSend(reservation) {
  if (!reservation?.ok) return;
  const { accountId, day } = reservation;
  await prisma.accountDailySend
    .updateMany({
      where: { accountId, day, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    })
    .catch((err) =>
      console.error(
        `⚠️ Could not release daily-count reservation for mailbox ${accountId}:`,
        err.message,
      ),
    );
  const cached = countCache.get(accountId);
  if (cached && cached.day === day.getTime() && cached.count > 0)
    cached.count -= 1;
}

/**
 * @deprecated Sends are now counted by tryReserveAccountSend(). Kept so
 * older imports don't break; it no longer writes anything.
 */
export function recordAccountSend() {}

/** Nothing is buffered any more; kept for worker.js shutdown compatibility. */
export async function flushAccountSends() {}

/** Delete counters older than N days (worker housekeeping). */
export async function purgeOldDailySends(
  days = Number(process.env.DAILY_SEND_RETENTION_DAYS) || 120,
) {
  const r = await prisma.accountDailySend.deleteMany({
    where: { day: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return r.count;
}