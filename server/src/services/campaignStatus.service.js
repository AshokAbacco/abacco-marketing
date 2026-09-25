// server/src/services/campaignStatus.service.js
//
// Explains a campaign in plain language for the CRM:
//   • what it is doing right now and WHY (sending / waiting / blocked)
//   • why recipients are still pending, why some failed or were skipped
//   • every mailbox: limit/hr, sent today vs daily cap, waiting reason, resume time
//   • when the campaign will realistically finish (hourly limits, daily caps,
//     cooldowns, the 5 PM reset and mailboxes shared with other campaigns)
//
// Runs in the API process and only READS the database. The worker writes
// the facts it needs (sent counts, cooldowns, heartbeat).

import prisma from "../prismaClient.js";
import {
  getDailyCount,
  DAILY_LIMIT,
  getDefaultHourlyLimit,
} from "./campaignMailer.service.js";
import {
  getAccountCap,
  getAccountSentToday,
  msUntilNextSendingDay,
} from "./sendingLimits.service.js";

const HEARTBEAT_KEY = "worker.heartbeat";
const WORKER_STALE_MS = Number(process.env.WORKER_STALE_MS) || 2 * 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const parseJson = (v, fallback) => {
  try {
    const x = JSON.parse(v || "");
    return x ?? fallback;
  } catch {
    return fallback;
  }
};

/* ── Pure helpers (exported for tests) ─────────────────────────────────── */

/**
 * Simulate sending in 15-minute steps to estimate the finish time.
 * @param {object} o
 * @param {number} o.now
 * @param {number} o.remaining               shared queue (normal campaigns)
 * @param {boolean} o.perMailbox             follow-ups: rows bound to a mailbox
 * @param {{hourly:number, capRoom:number, dailyCap:number, availableAt:number, remaining?:number}[]} o.mailboxes
 * @param {number} o.msToReset               ms until the next 5 PM reset
 * @param {number} o.companyRoom             company emails left today
 * @param {number} o.companyLimit            company emails per day
 * @returns {number|null} epoch ms, or null if it can never finish
 */
export function simulateEta({
  now,
  remaining,
  perMailbox = false,
  mailboxes,
  msToReset,
  companyRoom = Infinity,
  companyLimit = Infinity,
  stepMs = 15 * 60_000,
  maxDays = 90,
}) {
  const boxes = mailboxes
    .filter((m) => m.hourly > 0 && Number.isFinite(m.availableAt))
    .map((m) => ({ ...m, acc: 0 }));

  let left = perMailbox
    ? boxes.reduce((s, m) => s + (m.remaining || 0), 0)
    : remaining;
  if (left <= 0) return now;
  if (!boxes.length) return null;

  let room = companyRoom;
  let resetAt = now + Math.max(0, msToReset);
  const end = now + maxDays * DAY;

  for (let t = now; t < end; t += stepMs) {
    if (t >= resetAt) {
      for (const m of boxes) m.capRoom = m.dailyCap;
      room = companyLimit;
      resetAt += DAY;
    }
    for (const m of boxes) {
      if (m.availableAt > t) continue;
      // Unused capacity doesn't pile up while a mailbox is capped/blocked.
      const perStep = (m.hourly * stepMs) / HOUR;
      m.acc = Math.min(m.acc + perStep, perStep + 1);
      const want = Math.floor(m.acc);
      if (want <= 0) continue;
      const own = perMailbox ? m.remaining || 0 : left;
      const n = Math.max(0, Math.min(want, m.capRoom, room, own, left));
      if (n <= 0) continue;
      m.acc -= n;
      m.capRoom -= n;
      room -= n;
      left -= n;
      if (perMailbox) m.remaining -= n;
      if (left <= 0) return t + stepMs;
    }
  }
  return null;
}

export function formatIn(ms) {
  if (ms == null) return null;
  if (ms <= 60_000) return "less than a minute";
  const mins = Math.round(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d && `${d}d`, h && `${h}h`, !d && m && `${m}m`]
    .filter(Boolean)
    .join(" ");
}

function explainPending(row) {
  const err = String(row.error || "");
  if (row.status === "processing") return "Being sent right now";
  if (err.startsWith("Waiting:"))
    return `Waiting for its mailbox — ${err.slice(8).trim() || "mailbox unavailable"}`;
  if (row.retrying)
    return `Will be retried after a temporary error — ${err.replace(/^Retry \d+\/\d+ scheduled:\s*/i, "") || "temporary error"}`;
  if (err.startsWith("Recovered from stuck"))
    return "Re-queued after a worker restart (will be sent normally)";
  return "Queued — goes out as soon as a mailbox has room in its hourly limit";
}

function explainSkipped(err) {
  const e = String(err || "");
  if (/replied/i.test(e)) return "Already replied — follow-up not needed";
  if (/suppress|unsubscrib|do-not-contact|bounce/i.test(e))
    return `On the do-not-contact list${e ? ` (${e})` : ""}`;
  return e || "Skipped";
}

function groupReasons(rows, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const label = labelFn(r);
    map.set(label, (map.get(label) || 0) + r.n);
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/* ── Main ──────────────────────────────────────────────────────────────── */

export async function buildCampaignStatus(campaignId) {
  const now = Date.now();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      sendType: true,
      userId: true,
      createdAt: true,
      scheduledAt: true,
      estimatedCompletion: true,
      customLimits: true,
      fromAccountIds: true,
      parentCampaignId: true,
      error: true,
      parentCampaign: { select: { id: true, name: true } },
    },
  });
  if (!campaign) return null;

  const isFollowup = campaign.sendType === "followup";
  const customLimits = parseJson(campaign.customLimits, {}) || {};
  const fromIds = (parseJson(campaign.fromAccountIds, []) || [])
    .map(Number)
    .filter(Number.isInteger);

  const [totals, reasonRows, perAccount, heartbeat, sentToday, others] =
    await Promise.all([
      prisma.$queryRaw`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE "status" = 'sent')::int        AS sent,
               count(*) FILTER (WHERE "status" = 'pending')::int     AS pending,
               count(*) FILTER (WHERE "status" = 'processing')::int  AS processing,
               count(*) FILTER (WHERE "status" = 'failed')::int      AS failed,
               count(*) FILTER (WHERE "status" = 'skipped')::int     AS skipped,
               count(*) FILTER (WHERE "repliedAt" IS NOT NULL)::int  AS replied,
               count(*) FILTER (WHERE "bouncedAt" IS NOT NULL)::int  AS bounced,
               count(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL)::int AS unsubscribed,
               count(*) FILTER (WHERE "status" = 'sent' AND "sentAt" >= NOW() - interval '1 hour')::int AS "sentLastHour",
               count(*) FILTER (WHERE "status" = 'sent' AND "sentAt" >= NOW() - interval '24 hours')::int AS "sentLast24h",
               min("sentAt") FILTER (WHERE "status" = 'sent') AS "firstSentAt",
               max("sentAt") FILTER (WHERE "status" = 'sent') AS "lastSentAt"
        FROM "CampaignRecipient" WHERE "campaignId" = ${campaignId}`,
      prisma.$queryRaw`
        SELECT "status", ("retryCount" > 0) AS "retrying",
               LEFT(COALESCE("error", ''), 160) AS "error", count(*)::int AS n
        FROM "CampaignRecipient"
        WHERE "campaignId" = ${campaignId} AND "status" <> 'sent'
        GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 80`,
      prisma.$queryRaw`
        SELECT "accountId",
               count(*) FILTER (WHERE "status" = 'sent')::int       AS sent,
               count(*) FILTER (WHERE "status" = 'pending')::int    AS pending,
               count(*) FILTER (WHERE "status" = 'processing')::int AS processing,
               count(*) FILTER (WHERE "status" = 'failed')::int     AS failed,
               count(*) FILTER (WHERE "status" = 'sent' AND "sentAt" >= NOW() - interval '1 hour')::int AS "sentLastHour",
               max("sentAt") FILTER (WHERE "status" = 'sent') AS "lastSentAt"
        FROM "CampaignRecipient"
        WHERE "campaignId" = ${campaignId} AND "accountId" IS NOT NULL
        GROUP BY "accountId"`,
      prisma.crmSetting
        .findUnique({ where: { key: HEARTBEAT_KEY } })
        .catch(() => null),
      getDailyCount(campaign.userId).catch(() => 0),
      prisma.campaign.findMany({
        where: { status: "sending", id: { not: campaignId } },
        select: { id: true, name: true, fromAccountIds: true },
      }),
    ]);

  const k = totals[0] || {};
  const remaining = (k.pending || 0) + (k.processing || 0);
  const msToReset = msUntilNextSendingDay();
  const nextResetAt = new Date(now + msToReset);

  // Worker health
  const hbAt = heartbeat?.value?.at
    ? new Date(heartbeat.value.at).getTime()
    : null;
  const worker = {
    online: hbAt != null && now - hbAt < WORKER_STALE_MS,
    lastSeenAt: hbAt ? new Date(hbAt) : null,
    // Set by worker.js when it sees another worker's heartbeat.
    otherWorker: heartbeat?.value?.otherWorker || null,
    runningThisCampaign: Array.isArray(heartbeat?.value?.activeCampaigns)
      ? heartbeat.value.activeCampaigns.includes(campaignId)
      : null,
  };

  // Company daily limit
  const company = {
    sentToday,
    dailyLimit: DAILY_LIMIT,
    remainingToday: Math.max(0, DAILY_LIMIT - sentToday),
    resetsAt: nextResetAt,
  };
  const companyBlocked = company.remainingToday <= 0;

  // Mailboxes
  const perAcc = new Map(perAccount.map((r) => [Number(r.accountId), r]));
  const mailboxIds = [...new Set([...fromIds, ...perAcc.keys()])];
  const sharedBy = new Map(); // accountId → [{id,name}]
  for (const c of others) {
    for (const id of (parseJson(c.fromAccountIds, []) || []).map(Number)) {
      if (!mailboxIds.includes(id)) continue;
      if (!sharedBy.has(id)) sharedBy.set(id, []);
      sharedBy.get(id).push({ id: c.id, name: c.name });
    }
  }

  const accounts = mailboxIds.length
    ? await prisma.emailAccount.findMany({
        where: { id: { in: mailboxIds } },
        select: {
          id: true,
          email: true,
          provider: true,
          deleted: true,
          sendingPausedAt: true,
          sendingPausedReason: true,
          sendingPausedUntil: true,
          sendingCooldownUntil: true,
          sendingCooldownReason: true,
        },
      })
    : [];

  // Each mailbox's use of its hourly limit, across ALL campaigns.
  const hourRows = mailboxIds.length
    ? await prisma.$queryRaw`
        SELECT "accountId", count(*)::int AS n, min("sentAt") AS oldest
        FROM "CampaignRecipient"
        WHERE "accountId" = ANY(${mailboxIds}::int[])
          AND "status" = 'sent' AND "sentAt" >= NOW() - interval '1 hour'
        GROUP BY "accountId"`
    : [];
  const hourUse = new Map(hourRows.map((r) => [Number(r.accountId), r]));

  const capInfo = await Promise.all(
    accounts.map(async (a) => {
      const [cap, sent] = await Promise.all([
        getAccountCap(a.id).catch(() => ({
          cap: Infinity,
          source: "off",
          providerKey: null,
          providerLabel: a.provider || "Custom",
        })),
        getAccountSentToday(a.id).catch(() => 0),
      ]);
      return [a.id, { ...cap, sentToday: sent }];
    }),
  );
  const capById = new Map(capInfo);
  const isRunning = campaign.status === "sending";

  const mailboxes = accounts.map((a) => {
    const row = perAcc.get(a.id) || {};
    const cap = capById.get(a.id) || { cap: Infinity, sentToday: 0 };
    const limit =
      Number(customLimits[a.id]) > 0
        ? Number(customLimits[a.id])
        : getDefaultHourlyLimit(a.provider);
    const shared = sharedBy.get(a.id) || [];
    const effectiveHourly = limit / (1 + shared.length);
    const capRemaining = Number.isFinite(cap.cap)
      ? Math.max(0, cap.cap - cap.sentToday)
      : null;
    const cooldownUntil =
      a.sendingCooldownUntil && a.sendingCooldownUntil.getTime() > now
        ? a.sendingCooldownUntil
        : null;
    const [cdKind, ...cdRest] = String(a.sendingCooldownReason || "").split(
      ":",
    );
    const cdText = cdRest.join(":").trim();
    const adminPaused = false; // mailbox pauses no longer exist
    const ownPending = (row.pending || 0) + (row.processing || 0);

    let state = "sending";
    let severity = "ok";
    let message = `Sending now — up to ${limit}/hr`;
    let resumesAt = null;
    let etaAvailableAt = now;
    let etaExcluded = false;

    if (!isRunning) {
      state = "not_running";
      severity = "info";
      message = "Campaign is not sending";
    } else if (a.deleted) {
      state = "removed";
      severity = "error";
      message =
        "Mailbox was deleted — its share is sent by the other mailboxes";
      etaExcluded = true;
    } else if (adminPaused) {
      state = "admin_paused";
      severity = "error";
      message = `Paused by an admin on the Deliverability page${a.sendingPausedReason ? `: ${a.sendingPausedReason}` : ""}`;
      resumesAt = a.sendingPausedUntil || null;
      etaAvailableAt = resumesAt ? resumesAt.getTime() : Infinity;
      etaExcluded = !resumesAt;
    } else if (cooldownUntil && cdKind === "AUTH_ERROR") {
      state = "login_failed";
      severity = "error";
      message = `Login failed — retrying every 2 minutes; if it keeps failing, fix the password in Email Accounts${cdText ? ` (${cdText})` : ""}`;
      resumesAt = cooldownUntil;
      etaAvailableAt = Infinity;
      etaExcluded = true;
    } else if (cooldownUntil && cdKind === "QUOTA_EXHAUSTED") {
      state = "provider_limit";
      severity = "warning";
      message = `Provider refused (limit/quota) — retrying automatically every 2 minutes${cdText ? ` (${cdText})` : ""}`;
      resumesAt = cooldownUntil;
      etaAvailableAt = cooldownUntil.getTime();
    } else if (cooldownUntil) {
      state = "cooldown";
      severity = "warning";
      message = `Connection problem — retrying in 2 minutes${cdText ? ` (${cdText})` : ""}`;
      resumesAt = cooldownUntil;
      etaAvailableAt = cooldownUntil.getTime();
    } else if (capRemaining === 0) {
      state = "daily_cap";
      severity = "warning";
      message = `Daily limit reached (${cap.providerLabel}: ${cap.sentToday}/${cap.cap}) — unsent emails stay queued and resume automatically after the daily reset`;
      resumesAt = nextResetAt;
    } else if (companyBlocked) {
      state = "company_limit";
      severity = "warning";
      message = `Company daily limit reached (${sentToday}/${DAILY_LIMIT}) — resumes at the 5 PM reset`;
      resumesAt = nextResetAt;
    } else if ((hourUse.get(a.id)?.n || 0) >= limit) {
      const used = hourUse.get(a.id);
      state = "hourly_limit";
      severity = "info";
      resumesAt = new Date(new Date(used.oldest).getTime() + HOUR);
      message = `Used its ${limit}/hr — sends again at ${resumesAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} (limit refills every hour)`;
    } else if (isFollowup && ownPending === 0) {
      state = "done";
      severity = "ok";
      message = "Nothing left for this mailbox";
    }

    // Cooldown just ended but the provider refused again recently and nothing
    // has gone out since: say so instead of a plain "Sending".
    const cdEnded =
      a.sendingCooldownUntil && a.sendingCooldownUntil.getTime() <= now
        ? a.sendingCooldownUntil.getTime()
        : null;
    const lastOk = row.lastSentAt ? new Date(row.lastSentAt).getTime() : 0;
    if (
      state === "sending" &&
      cdEnded &&
      now - cdEnded < 10 * 60_000 &&
      lastOk < cdEnded - 2 * 60_000 &&
      ["QUOTA_EXHAUSTED", "AUTH_ERROR"].includes(cdKind)
    ) {
      state = cdKind === "AUTH_ERROR" ? "login_failed" : "provider_limit";
      severity = cdKind === "AUTH_ERROR" ? "error" : "warning";
      message = `${cdKind === "AUTH_ERROR" ? "Login keeps failing" : "Provider keeps refusing"} — retrying every 2 minutes${cdText ? ` (${cdText})` : ""}. You can cancel this mailbox's unsent emails below.`;
    }

    if (state === "sending" && shared.length) {
      message += ` (hourly limit shared with ${shared.length} other sending campaign${shared.length > 1 ? "s" : ""})`;
    }

    const nextSendAt = state === "sending" ? new Date(now) : resumesAt;

    return {
      id: a.id,
      email: a.email,
      provider: a.provider,
      providerKey: cap.providerKey || null,
      providerLabel: cap.providerLabel || a.provider || "Custom",
      state,
      severity,
      message,
      resumesAt,
      nextSendAt,
      hourlyLimit: limit,
      effectiveHourly: Math.round(effectiveHourly * 10) / 10,
      sharedWith: shared,
      dailyCap: Number.isFinite(cap.cap) ? cap.cap : null,
      capSource: cap.source,
      sentToday: cap.sentToday,
      capRemaining,
      // Same numbers under the names the UI shows: limit / sent / remaining.
      dailyLimit: Number.isFinite(cap.cap) ? cap.cap : null,
      remainingToday: capRemaining,
      sentByCampaign: row.sent || 0,
      sentLastHour: row.sentLastHour || 0,
      failed: row.failed || 0,
      // Follow-ups: exact (rows are bound to a mailbox). Normal campaigns
      // share one queue, so this is filled in below as an estimate.
      pending: isFollowup ? ownPending : null,
      pendingIsEstimate: !isFollowup,
      lastSentAt: row.lastSentAt || null,
      _eta: {
        hourly: etaExcluded ? 0 : effectiveHourly,
        capRoom: capRemaining ?? Infinity,
        dailyCap: Number.isFinite(cap.cap) ? cap.cap : Infinity,
        availableAt: etaAvailableAt,
        remaining: ownPending,
      },
    };
  });

  // Normal campaigns: every mailbox drains ONE shared queue, so there is
  // no exact per-mailbox pending. Estimate each mailbox's share: split the
  // queue evenly over the mailboxes still in use. (A mailbox at its daily
  // limit hands its share to the others while they have room.)
  if (!isFollowup) {
    const active = mailboxes.filter((m) => m.state !== "removed");
    const base = active.length ? Math.floor(remaining / active.length) : 0;
    let extra = active.length ? remaining % active.length : 0;
    for (const m of mailboxes) {
      if (m.state === "removed") {
        m.pending = 0;
        continue;
      }
      m.pending = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
    }
  }
  for (const m of mailboxes) {
    const p = m.pending || 0;
    m.sendableToday =
      m.capRemaining == null ? p : Math.min(p, m.capRemaining);
    // Emails that will wait for the daily reset (at today's limit).
    m.afterReset = Math.max(0, p - m.sendableToday);
  }

  // ETA
  let eta = { at: null, in: null, ratePerHour: 0, note: null };
  if (remaining === 0) {
    eta = {
      at: k.lastSentAt || null,
      in: null,
      ratePerHour: 0,
      note: "Nothing left to send",
    };
  } else if (["sending", "scheduled"].includes(campaign.status)) {
    const start =
      campaign.status === "scheduled" && campaign.scheduledAt
        ? Math.max(now, campaign.scheduledAt.getTime())
        : now;
    const at = simulateEta({
      now: start,
      remaining,
      perMailbox: isFollowup,
      mailboxes: mailboxes.map((m) => ({
        ...m._eta,
        availableAt: Math.max(m._eta.availableAt, start),
      })),
      msToReset: msToReset - (start - now),
      companyRoom: company.remainingToday,
      companyLimit: DAILY_LIMIT,
    });
    const excluded = mailboxes.filter((m) => m._eta.hourly === 0).length;
    eta = {
      at: at ? new Date(at) : null,
      in: at ? formatIn(at - now) : null,
      ratePerHour: Math.round(
        mailboxes
          .filter((m) => ["sending", "not_running"].includes(m.state))
          .reduce((s, m) => s + m.effectiveHourly, 0),
      ),
      note: at
        ? `Based on each mailbox's hourly limit${excluded ? `; ${excluded} blocked mailbox(es) not counted` : ""}.`
        : "Cannot estimate — no mailbox is able to send. Fix the blocked mailboxes below.",
    };
  }
  for (const m of mailboxes) delete m._eta;

  // Why pending / failed / skipped
  const pendingReasons = groupReasons(
    reasonRows.filter(
      (r) => r.status === "pending" || r.status === "processing",
    ),
    explainPending,
  );
  const failedReasons = groupReasons(
    reasonRows.filter((r) => r.status === "failed"),
    (r) => r.error || "Unknown error",
  );
  const skippedReasons = groupReasons(
    reasonRows.filter((r) => r.status === "skipped"),
    (r) => explainSkipped(r.error),
  );

  // Headline
  const summary = summarize({
    campaign,
    k,
    remaining,
    worker,
    mailboxes,
    company,
    eta,
    now,
    isFollowup,
  });

  return {
    campaign: {
      id: campaign.id,
      number: `#${campaign.id}`,
      name: campaign.name,
      status: campaign.status,
      sendType: campaign.sendType,
      followupOf: campaign.parentCampaign || null,
      createdAt: campaign.createdAt,
      scheduledAt: campaign.scheduledAt,
      firstSentAt: k.firstSentAt || null,
      lastSentAt: k.lastSentAt || null,
      originalEstimate: campaign.estimatedCompletion,
    },
    summary,
    counts: {
      total: k.total || 0,
      sent: k.sent || 0,
      pending: k.pending || 0,
      processing: k.processing || 0,
      failed: k.failed || 0,
      skipped: k.skipped || 0,
      replied: k.replied || 0,
      bounced: k.bounced || 0,
      unsubscribed: k.unsubscribed || 0,
      remaining,
      percent: k.total
        ? Math.round(((k.total - remaining) / k.total) * 1000) / 10
        : 0,
      sentLastHour: k.sentLastHour || 0,
      sentLast24h: k.sentLast24h || 0,
    },
    eta,
    pendingReasons,
    failedReasons,
    skippedReasons,
    mailboxes,
    company,
    worker,
    generatedAt: new Date(now),
  };
}

/** "2 × 30/hr = 60/hr" or "40/hr + 10/hr = 50/hr" (campaign total). */
function rateBreakdown(list) {
  const limits = list.map((m) => m.effectiveHourly);
  const total = Math.round(limits.reduce((a, b) => a + b, 0));
  if (limits.length === 1) return `${total}/hr`;
  const same = limits.every((l) => l === limits[0]);
  return same
    ? `${limits.length} × ${limits[0]}/hr = ${total}/hr`
    : `${limits.map((l) => `${l}/hr`).join(" + ")} = ${total}/hr`;
}

function summarize({
  campaign,
  k,
  remaining,
  worker,
  mailboxes,
  company,
  eta,
  now,
}) {
  const fmt = (d) =>
    d
      ? new Date(d).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";

  switch (campaign.status) {
    case "draft":
      return {
        code: "draft",
        severity: "info",
        title: "Draft",
        message: "Created but never started.",
      };
    case "scheduled": {
      const at = campaign.scheduledAt?.getTime();
      if (at && at > now)
        return {
          code: "scheduled",
          severity: "info",
          title: "Scheduled",
          message: `Starts automatically at ${fmt(at)} IST.`,
        };
      if (!worker.online)
        return {
          code: "worker_offline",
          severity: "error",
          title: "Not starting — worker offline",
          message:
            "The start time has passed but the background worker is not running, so nothing can start. Restart the worker service (npm run start:worker).",
        };
      return {
        code: "starting",
        severity: "info",
        title: "Starting",
        message: "Start time reached — the worker picks it up within a minute.",
      };
    }
    case "completed":
      return {
        code: "completed",
        severity: k.failed ? "warning" : "ok",
        title: "Completed",
        message: `Finished${k.lastSentAt ? ` at ${fmt(k.lastSentAt)} IST` : ""}: ${k.sent} sent, ${k.failed} failed, ${k.skipped} skipped.`,
      };
    case "failed":
      return {
        code: "failed",
        severity: "error",
        title: "Failed",
        message:
          campaign.error ||
          "Every recipient failed. See the failure reasons below.",
      };
    case "stopped":
    case "paused":
      return {
        code: "paused",
        severity: "warning",
        title: "Paused",
        message: `${campaign.error && campaign.error.startsWith("Paused by") ? campaign.error + ". " : "Paused. "}${remaining} email(s) still to send — click Resend to continue exactly where it stopped. Already-sent recipients are never emailed twice.`,
      };
    case "sending":
      break;
    default:
      return {
        code: campaign.status,
        severity: "info",
        title: campaign.status,
        message: "",
      };
  }

  if (!worker.online) {
    return {
      code: "worker_offline",
      severity: "error",
      title: "Not sending — worker offline",
      message: `The background worker has not reported since ${worker.lastSeenAt ? fmt(worker.lastSeenAt) + " IST" : "it was deployed"}. Nothing can send until it runs again (Render → Background Worker → npm run start:worker). Sending resumes by itself once it is back.`,
    };
  }
  if (remaining === 0) {
    return {
      code: "finishing",
      severity: "ok",
      title: "Finishing",
      message: "All recipients processed — marking the campaign complete.",
    };
  }

  const sending = mailboxes.filter((m) => m.state === "sending");
  const blocked = mailboxes.filter(
    (m) =>
      !["sending", "done", "not_running", "hourly_limit"].includes(m.state),
  );
  const hourlyFull = mailboxes.filter((m) => m.state === "hourly_limit");
  const byState = {};
  for (const m of blocked) byState[m.state] = (byState[m.state] || 0) + 1;
  const LABEL = {
    daily_cap: "reached their daily cap",
    company_limit: "hit the company daily limit",
    provider_limit: "were slowed down by the provider",
    cooldown: "are in a short cooldown",
    login_failed: "have a login failure",
    admin_paused: "are paused by an admin",
    removed: "were deleted",
  };
  const blockedText = Object.entries(byState)
    .map(([s, n]) => `${n} ${LABEL[s] || s}`)
    .join(", ");
  const nextResume = blocked
    .map((m) => m.resumesAt && new Date(m.resumesAt).getTime())
    .filter((t) => t && t > now)
    .sort((a, b) => a - b)[0];

  if (!sending.length && hourlyFull.length && !blocked.length) {
    const next = hourlyFull
      .map((m) => new Date(m.resumesAt).getTime())
      .sort((a, b) => a - b)[0];
    return {
      code: "hourly_limit",
      severity: "info",
      title: "Sending (hourly limits used)",
      message: `All mailboxes used their hourly limit. ${remaining} left — sending continues at ${fmt(next)} IST${eta.at ? `, expected to finish ${fmt(eta.at)} IST (in ${eta.in})` : ""}. No action needed.`,
      resumesAt: new Date(next),
    };
  }

  if (!sending.length) {
    const hard = blocked.every((m) =>
      ["login_failed", "admin_paused", "removed"].includes(m.state),
    );
    return {
      code:
        company.remainingToday <= 0
          ? "company_limit"
          : hard
            ? "blocked"
            : "waiting",
      severity: hard ? "error" : "warning",
      title: hard
        ? "Blocked — action needed"
        : "Waiting (will resume automatically)",
      message:
        `${remaining} recipient(s) left, but no mailbox can send right now: ${blockedText || "no mailboxes"}.` +
        (nextResume ? ` Next mailbox resumes at ${fmt(nextResume)} IST.` : "") +
        (hard
          ? " Fix the mailboxes listed below — sending restarts by itself."
          : " No action needed."),
      resumesAt: nextResume ? new Date(nextResume) : null,
    };
  }

  return {
    code: "sending",
    severity: blocked.length ? "info" : "ok",
    title: "Sending",
    message:
      `Sending with ${sending.length} of ${mailboxes.length} mailbox(es) — ${rateBreakdown(sending)} in total. ` +
      `${remaining} left${eta.at ? `, expected to finish ${fmt(eta.at)} IST (in ${eta.in})` : ""}.` +
      (k.processing ? ` ${k.processing} going out right now.` : "") +
      (blocked.length
        ? ` ${blocked.length} mailbox(es) waiting: ${blockedText}.`
        : ""),
  };
}