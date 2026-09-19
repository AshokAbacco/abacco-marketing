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

/** Start of the current sending window. */
export function getSendingDayStart(now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: SEND_DAY_TZ }));
  const reset = new Date(local);
  reset.setHours(SEND_DAY_RESET_HOUR, 0, 0, 0);
  const start = local < reset ? new Date(reset.getTime() - 86_400_000) : reset;
  start.setMilliseconds(0);
  return start;
}

/** Milliseconds until the next window opens. */
export function msUntilNextSendingDay(now = new Date()) {
  const next = new Date(getSendingDayStart(now).getTime() + 86_400_000);
  const local = new Date(now.toLocaleString("en-US", { timeZone: SEND_DAY_TZ }));
  return Math.max(1000, next.getTime() - local.getTime());
}

/* ── Settings ──────────────────────────────────────────────────────────── */

export const DEFAULT_SENDING_LIMITS = Object.freeze({
  /// Used when a provider isn't listed below
  defaultDailyCap: 150,
  providerCaps: {
    gmail: 100,     // free Gmail: keep well under the ~500 limit
    gsuite: 400,    // Google Workspace
    outlook: 100,
    office365: 400,
    zoho: 150,
    rediff: 80,
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
    enabled: stored.enabled !== undefined ? Boolean(stored.enabled) : base.enabled,
    defaultDailyCap: Number(stored.defaultDailyCap) > 0 ? Math.round(Number(stored.defaultDailyCap)) : base.defaultDailyCap,
    providerCaps: { ...base.providerCaps, ...(stored.providerCaps || {}) },
    warmup: { ...base.warmup, ...(stored.warmup || {}) },
  };
}

export function validateSendingLimits(input) {
  if (!input || typeof input !== "object") return { error: "Settings must be an object" };
  const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return { error: `${label} must be ${min}–${max}` };
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
  const inc = int(input.warmup?.incrementPerDay, 1, 10_000, "Warm-up daily increase");
  if (inc.error) return inc;
  const target = int(input.warmup?.targetCap, 1, 100_000, "Warm-up target");
  if (target.error) return target;
  if (target.value < start.value) return { error: "Warm-up target must be at least the start value" };

  return {
    value: {
      enabled: Boolean(input.enabled),
      defaultDailyCap: cap.value,
      providerCaps,
      warmup: { startCap: start.value, incrementPerDay: inc.value, targetCap: target.value },
    },
  };
}

export async function saveSendingLimits(value, userId) {
  await saveSetting("sendingLimits", value, userId);
  capCache.clear();
}

/* ── Effective cap per mailbox ─────────────────────────────────────────── */

const CAP_TTL_MS = Number(process.env.ACCOUNT_CAP_CACHE_MS) || 60_000;
const capCache = new Map(); // accountId → { cap, source, at }

/**
 * How many emails this mailbox may send today, and why.
 * @returns {{ cap: number, source: "manual"|"warmup"|"provider"|"default"|"off", warmupDay?: number }}
 */
export function computeDailyCap(account, limits, now = new Date()) {
  if (!limits.enabled) return { cap: Infinity, source: "off" };
  if (Number.isInteger(account.dailyCap) && account.dailyCap > 0) {
    return { cap: account.dailyCap, source: "manual" };
  }

  const provider = String(account.provider || "").toLowerCase();
  const ceiling = limits.providerCaps[provider] || limits.defaultDailyCap;

  if (account.warmupEnabled) {
    const start = account.warmupStartAt ? new Date(account.warmupStartAt) : null;
    const startCap = account.warmupStartCap || limits.warmup.startCap;
    const target = Math.min(account.warmupTarget || limits.warmup.targetCap, ceiling);
    const dayIndex = start
      ? Math.max(0, Math.floor((getSendingDayStart(now) - getSendingDayStart(start)) / 86_400_000))
      : 0;
    const cap = Math.min(target, startCap + dayIndex * limits.warmup.incrementPerDay);
    return { cap: Math.max(1, cap), source: "warmup", warmupDay: dayIndex + 1 };
  }

  return { cap: ceiling, source: limits.providerCaps[provider] ? "provider" : "default" };
}

export async function getAccountCap(accountId, { fresh = false } = {}) {
  const hit = capCache.get(accountId);
  if (!fresh && hit && Date.now() - hit.at < CAP_TTL_MS) return hit;
  const [account, limits] = await Promise.all([
    prisma.emailAccount.findUnique({
      where: { id: accountId },
      select: { id: true, provider: true, dailyCap: true, warmupEnabled: true, warmupStartAt: true, warmupStartCap: true, warmupTarget: true },
    }),
    getSendingLimits(),
  ]);
  const value = account ? { ...computeDailyCap(account, limits), at: Date.now() } : { cap: 0, source: "default", at: Date.now() };
  capCache.set(accountId, value);
  return value;
}

export function invalidateCapCache(accountId) {
  if (accountId === undefined) capCache.clear();
  else capCache.delete(Number(accountId));
}

/* ── Counting today's sends ────────────────────────────────────────────────
   Buffered like the company-wide daily log: counted in memory and flushed
   every few seconds, so a mailbox sending every second doesn't write a row
   every second.                                                          */

const COUNT_TTL_MS = 10_000;
const countCache = new Map();  // accountId → { day, count, at }
const buffer = new Map();      // `${accountId}|${dayMs}` → { accountId, day, count }
let flushTimer = null;
let flushing = null;
const FLUSH_MS = Number(process.env.ACCOUNT_SEND_FLUSH_MS) || 5000;

function bufferedFor(accountId, dayMs) {
  return buffer.get(`${accountId}|${dayMs}`)?.count || 0;
}

/** Emails this mailbox has sent in the current window. */
export async function getAccountSentToday(accountId, { fresh = false } = {}) {
  const day = getSendingDayStart();
  const dayMs = day.getTime();
  const hit = countCache.get(accountId);
  if (!fresh && hit && hit.day === dayMs && Date.now() - hit.at < COUNT_TTL_MS) return hit.count;

  const row = await prisma.accountDailySend.findUnique({
    where: { accountId_day: { accountId, day } },
    select: { count: true },
  });
  const count = (row?.count || 0) + bufferedFor(accountId, dayMs);
  countCache.set(accountId, { day: dayMs, count, at: Date.now() });
  return count;
}

/** Count one sent email (buffered). */
export function recordAccountSend(accountId) {
  const day = getSendingDayStart();
  const key = `${accountId}|${day.getTime()}`;
  const entry = buffer.get(key) || { accountId, day, count: 0 };
  entry.count += 1;
  buffer.set(key, entry);

  const cached = countCache.get(accountId);
  if (cached && cached.day === day.getTime()) cached.count += 1;

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushAccountSends().catch((err) => console.error("⚠️ Mailbox send counter flush failed:", err.message));
    }, FLUSH_MS);
    flushTimer.unref?.();
  }
}

/** Write buffered counts. Exported so the worker can flush on shutdown. */
export async function flushAccountSends() {
  if (flushing) return flushing;
  if (buffer.size === 0) return;
  const entries = [...buffer.values()];
  buffer.clear();

  flushing = (async () => {
    for (const e of entries) {
      try {
        await prisma.accountDailySend.upsert({
          where: { accountId_day: { accountId: e.accountId, day: e.day } },
          update: { count: { increment: e.count } },
          create: { accountId: e.accountId, day: e.day, count: e.count },
          select: { id: true },
        });
      } catch (err) {
        // Put it back so nothing is lost.
        const key = `${e.accountId}|${e.day.getTime()}`;
        const cur = buffer.get(key);
        if (cur) cur.count += e.count;
        else buffer.set(key, e);
        throw err;
      }
    }
  })();

  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

/** Delete counters older than N days (worker housekeeping). */
export async function purgeOldDailySends(days = Number(process.env.DAILY_SEND_RETENTION_DAYS) || 120) {
  const r = await prisma.accountDailySend.deleteMany({
    where: { day: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return r.count;
}
