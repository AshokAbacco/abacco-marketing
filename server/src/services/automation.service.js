// src/services/automation.service.js
//
// Phase 3 automation:
//   • settings        — company-wide JSON settings (CrmSetting table)
//   • merge fields    — {{firstName}}, {{company|your team}} … in emails
//   • reply automation— classified replies move deals, create tasks, notify
//   • sequences       — "no reply after N days → next follow-up" engine

import prisma from "../prismaClient.js";
import {
  logActivity,
  notify,
  ensureDealForContact,
  listStages,
  displayName,
} from "./crm.service.js";
import { REPLY_CATEGORIES, CATEGORY_LABELS } from "./replyClassifier.service.js";

/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_REPLY_AUTOMATION = Object.freeze({
  enabled: true,
  createDealIfMissing: true,
  rules: {
    interested:     { stageName: "Interested", stageId: null, task: true,  taskDueHours: 4,  notify: true,  markLost: false },
    meeting:        { stageName: "Interested", stageId: null, task: true,  taskDueHours: 2,  notify: true,  markLost: false },
    question:       { stageName: "Replied",    stageId: null, task: true,  taskDueHours: 24, notify: true,  markLost: false },
    other:          { stageName: "Replied",    stageId: null, task: false, taskDueHours: 24, notify: true,  markLost: false },
    not_interested: { stageName: null,         stageId: null, task: false, taskDueHours: 24, notify: true,  markLost: false },
    wrong_person:   { stageName: null,         stageId: null, task: true,  taskDueHours: 48, notify: true,  markLost: false },
    unsubscribe:    { stageName: null,         stageId: null, task: false, taskDueHours: 24, notify: false, markLost: false },
  },
});

const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map(); // key → { value, at }

export async function getSetting(key, fallback) {
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
  const row = await prisma.crmSetting.findUnique({ where: { key } });
  const value = row?.value ?? fallback;
  settingsCache.set(key, { value, at: Date.now() });
  return value;
}

export async function saveSetting(key, value, userId) {
  await prisma.crmSetting.upsert({
    where: { key },
    update: { value, updatedById: userId },
    create: { key, value, updatedById: userId },
  });
  settingsCache.set(key, { value, at: Date.now() });
}

/** Merge stored settings over defaults so new categories always have rules. */
export async function getReplyAutomationSettings() {
  const stored = await getSetting("replyAutomation", null);
  const base = structuredClone(DEFAULT_REPLY_AUTOMATION);
  if (!stored || typeof stored !== "object") return base;
  return {
    enabled: stored.enabled !== undefined ? Boolean(stored.enabled) : base.enabled,
    createDealIfMissing: stored.createDealIfMissing !== undefined ? Boolean(stored.createDealIfMissing) : base.createDealIfMissing,
    rules: Object.fromEntries(
      REPLY_CATEGORIES.map((c) => [c, { ...base.rules[c], ...(stored.rules?.[c] || {}) }])
    ),
  };
}

/** Validate a settings object from the admin UI. Returns { value } or { error }. */
export function validateReplyAutomation(input) {
  if (!input || typeof input !== "object") return { error: "Settings must be an object" };
  const rules = {};
  for (const c of REPLY_CATEGORIES) {
    const r = input.rules?.[c] || {};
    const hours = Number(r.taskDueHours ?? DEFAULT_REPLY_AUTOMATION.rules[c].taskDueHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 30) return { error: `${c}: task due hours must be 0–720` };
    const stageId = r.stageId === null || r.stageId === undefined || r.stageId === "" ? null : Number(r.stageId);
    if (stageId !== null && !Number.isInteger(stageId)) return { error: `${c}: invalid stage` };
    rules[c] = {
      stageName: stageId ? null : (r.stageName ? String(r.stageName).slice(0, 50) : null),
      stageId,
      task: Boolean(r.task),
      taskDueHours: Math.round(hours),
      notify: Boolean(r.notify),
      markLost: Boolean(r.markLost),
    };
    if (rules[c].markLost && (rules[c].stageId || rules[c].stageName)) {
      return { error: `${c}: choose either "move to stage" or "mark deal lost", not both` };
    }
  }
  return {
    value: {
      enabled: Boolean(input.enabled),
      createDealIfMissing: Boolean(input.createDealIfMissing),
      rules,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   MERGE FIELDS
   {{firstName}}  {{lastName}}  {{fullName}}  {{company}}  {{email}}  {{jobTitle}}  {{country}}
   Fallbacks:  {{firstName|there}}  →  "there" when the contact has no first name.
   Unknown tags are left untouched.
══════════════════════════════════════════════════════════════════════════ */

export const MERGE_FIELDS = ["firstName", "lastName", "fullName", "company", "email", "jobTitle", "country"];
const MERGE_RE = /\{\{\s*([a-zA-Z]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

const escapeHtml = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function hasMergeFields(text) {
  if (!text || !text.includes("{{")) return false;
  MERGE_RE.lastIndex = 0;
  return MERGE_RE.test(text);
}

/** Replace merge tags. `html` = escape values for HTML output. */
export function renderMergeFields(text, vars, { html = true } = {}) {
  if (!text || !text.includes("{{")) return text;
  return text.replace(MERGE_RE, (whole, name, fallback) => {
    if (!MERGE_FIELDS.includes(name)) return whole;
    const raw = vars?.[name];
    const value = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : (fallback ?? "");
    return html ? escapeHtml(value) : value;
  });
}

/** Merge values for a recipient address (from the CRM contact, if any). */
export async function mergeVarsFor(email) {
  const e = String(email || "").trim().toLowerCase();
  const contact = await prisma.contact.findUnique({
    where: { email: e },
    select: { firstName: true, lastName: true, name: true, jobTitle: true, country: true, companyId: true },
  });
  let company = null;
  if (contact?.companyId) {
    company = (await prisma.company.findUnique({ where: { id: contact.companyId }, select: { name: true } }))?.name || null;
  }
  const fullName = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.name || null : null;
  return {
    firstName: contact?.firstName || (fullName ? fullName.split(" ")[0] : null),
    lastName: contact?.lastName || null,
    fullName,
    company,
    email: e,
    jobTitle: contact?.jobTitle || null,
    country: contact?.country || null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   REPLY AUTOMATION
══════════════════════════════════════════════════════════════════════════ */

async function resolveStage(rule, stages) {
  if (rule.stageId) return stages.find((s) => s.id === rule.stageId) || null;
  if (rule.stageName) return stages.find((s) => s.name.toLowerCase() === rule.stageName.toLowerCase()) || null;
  return null;
}

async function moveDealTo(deal, stage, { reason, userId = null, lostReason = null }) {
  const data = { stageId: stage.id, status: stage.kind };
  data.closedAt = stage.kind === "open" ? null : new Date();
  if (stage.kind === "lost") data.lostReason = lostReason;
  const last = await prisma.deal.findFirst({
    where: { stageId: stage.id }, orderBy: { position: "desc" }, select: { position: true },
  });
  data.position = (last?.position ?? 0) + 1000;
  // Conditional: only if nobody moved it meanwhile.
  const res = await prisma.deal.updateMany({ where: { id: deal.id, stageId: deal.stageId }, data });
  if (!res.count) return false;
  const from = await prisma.pipelineStage.findUnique({ where: { id: deal.stageId }, select: { name: true } });
  await logActivity({
    type: "stage_change",
    title: `${deal.title}: ${from?.name || "?"} → ${stage.name} (automatic — ${reason})`,
    meta: { fromStageId: deal.stageId, toStageId: stage.id, automatic: true },
    dealId: deal.id,
    contactId: deal.contactId,
    userId,
  });
  return true;
}

/**
 * React to a classified reply. Idempotent per reply event.
 * @returns {Promise<{ dealId?: number, moved?: boolean, taskId?: number, notified?: boolean } | null>}
 */
export async function applyReplyAutomation({ replyEvent, contact }) {
  if (!replyEvent?.category || !contact) return null;
  const settings = await getReplyAutomationSettings();
  if (!settings.enabled) return null;
  const rule = settings.rules[replyEvent.category];
  if (!rule) return null;

  const stages = await listStages();
  const target = await resolveStage(rule, stages);
  const label = CATEGORY_LABELS[replyEvent.category] || replyEvent.category;
  const who = displayName(contact);
  const result = {};

  let deal = await prisma.deal.findFirst({
    where: { contactId: contact.id, status: "open" },
    orderBy: { updatedAt: "desc" },
  });

  const positive = ["interested", "meeting", "question", "other"].includes(replyEvent.category);
  if (!deal && target && target.kind === "open" && positive && settings.createDealIfMissing) {
    const created = await ensureDealForContact({
      contact,
      ownerId: contact.ownerId,
      externalKey: `reply:${replyEvent.id}`,
      stageName: target.name,
      source: "reply",
    });
    deal = created?.deal || null;
    if (created?.created) result.moved = true;
  } else if (deal && target && target.kind === "open") {
    // Forward only: never pull a deal back to an earlier stage.
    const current = stages.find((s) => s.id === deal.stageId);
    if (current && current.kind === "open" && target.position > current.position) {
      result.moved = await moveDealTo(deal, target, { reason: `${label.toLowerCase()} reply` });
    }
  } else if (deal && target && target.kind !== "open") {
    result.moved = await moveDealTo(deal, target, { reason: `${label.toLowerCase()} reply`, lostReason: `Replied: ${label}` });
  }

  if (deal && rule.markLost) {
    const lost = stages.find((s) => s.kind === "lost");
    if (lost && deal.status === "open") {
      result.moved = await moveDealTo(deal, lost, { reason: `${label.toLowerCase()} reply`, lostReason: `Replied: ${label}` });
    }
  }
  if (deal) result.dealId = deal.id;

  if (rule.task) {
    const dueAt = new Date(Date.now() + rule.taskDueHours * 3_600_000);
    try {
      const task = await prisma.task.create({
        data: {
          title: `${label} reply from ${who} — respond`,
          description: replyEvent.snippet ? `“${replyEvent.snippet}”` : null,
          dueAt,
          remindAt: dueAt,
          priority: ["interested", "meeting"].includes(replyEvent.category) ? "high" : "normal",
          contactId: contact.id,
          dealId: deal?.id ?? null,
          assignedToId: contact.ownerId,
          externalKey: `reply:${replyEvent.id}`,
        },
      });
      result.taskId = task.id;
    } catch (err) {
      if (err.code !== "P2002") throw err; // task for this reply already exists
    }
  }

  if (rule.notify) {
    await notify(contact.ownerId, {
      type: "reply_received",
      title: `${label} reply from ${who}`,
      body: replyEvent.snippet || null,
      link: `/crm/replies?open=${replyEvent.id}`,
    });
    result.notified = true;
  }

  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
   FOLLOW-UP SEQUENCES
══════════════════════════════════════════════════════════════════════════ */

const SEQ_BATCH = Number(process.env.SEQUENCE_BATCH_SIZE) || 500;

async function busyAccountIds() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT r."accountId"
    FROM "CampaignRecipient" r
    JOIN "Campaign" c ON c."id" = r."campaignId"
    WHERE c."status" = 'sending'
      AND r."status" IN ('pending', 'processing')
      AND r."accountId" IS NOT NULL
  `;
  return new Set(rows.map((r) => Number(r.accountId)));
}

/** Enroll base-campaign recipients that have been sent and aren't enrolled yet. */
async function enrollNew(seq, firstStep) {
  return prisma.$executeRaw`
    INSERT INTO "SequenceEnrollment"
      ("sequenceId", "email", "rootRecipientId", "accountId", "nextDueAt", "status", "createdAt", "updatedAt")
    SELECT ${seq.id}, lower(r."email"), r."id", r."accountId",
           r."sentAt" + make_interval(days => ${firstStep.delayDays}::int), 'active', NOW(), NOW()
    FROM "CampaignRecipient" r
    WHERE r."campaignId" = ${seq.campaignId}
      AND r."status" = 'sent'
      AND r."sentAt" IS NOT NULL
      AND r."accountId" IS NOT NULL
    ON CONFLICT ("sequenceId", "email") DO NOTHING
  `;
}

/** Stop people who replied, bounced or unsubscribed. */
async function stopFinished(seq) {
  const replied = await prisma.$executeRaw`
    UPDATE "SequenceEnrollment" e
    SET "status" = 'replied', "stoppedReason" = 'Replied', "nextDueAt" = NULL, "updatedAt" = NOW()
    FROM "CampaignRecipient" r
    WHERE e."sequenceId" = ${seq.id}
      AND e."status" IN ('active', 'completed')
      AND r."id" = e."rootRecipientId"
      AND (
        r."repliedAt" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "ReplyEvent" x WHERE x."email" = e."email" AND x."receivedAt" >= r."sentAt")
      )
  `;
  const bounced = await prisma.$executeRaw`
    UPDATE "SequenceEnrollment" e
    SET "status" = 'bounced', "stoppedReason" = 'Address bounced', "nextDueAt" = NULL, "updatedAt" = NOW()
    FROM "CampaignRecipient" r
    WHERE e."sequenceId" = ${seq.id}
      AND e."status" = 'active'
      AND r."id" = e."rootRecipientId"
      AND (
        r."bounceType" = 'hard'
        OR EXISTS (SELECT 1 FROM "EmailBounce" b WHERE b."email" = e."email" AND b."type" = 'hard' AND b."createdAt" >= r."sentAt")
      )
  `;
  const unsubscribed = await prisma.$executeRaw`
    UPDATE "SequenceEnrollment" e
    SET "status" = 'unsubscribed', "stoppedReason" = 'On do-not-contact list', "nextDueAt" = NULL, "updatedAt" = NOW()
    WHERE e."sequenceId" = ${seq.id}
      AND e."status" = 'active'
      AND EXISTS (SELECT 1 FROM "SuppressedEmail" s WHERE s."email" = e."email")
  `;
  return { replied, bounced, unsubscribed };
}

/**
 * Queue due people for step k+1 (k = steps already sent) into a new
 * follow-up campaign. Claim + campaign creation happen in one transaction.
 */
async function queueStep(seq, root, steps, k, busy) {
  const step = steps[k];
  const next = steps[k + 1];
  const isLast = !next;
  const busyList = [...busy];

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw`
      UPDATE "SequenceEnrollment" e
      SET "stepsSent" = e."stepsSent" + 1,
          "lastStepAt" = NOW(),
          "updatedAt" = NOW(),
          "nextDueAt" = ${isLast ? null : new Date(Date.now() + (next?.delayDays || 0) * 86_400_000)},
          "status" = ${isLast ? "completed" : "active"}
      WHERE e."id" IN (
        SELECT "id" FROM "SequenceEnrollment"
        WHERE "sequenceId" = ${seq.id}
          AND "status" = 'active'
          AND "stepsSent" = ${k}
          AND "nextDueAt" <= NOW()
          AND NOT ("accountId" = ANY(${busyList}::int[]))
        ORDER BY "id"
        LIMIT ${SEQ_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING e."id", e."email", e."accountId"
    `;
    if (!claimed.length) return null;

    const accountIds = [...new Set(claimed.map((c) => Number(c.accountId)))];
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const campaign = await tx.campaign.create({
      data: {
        name: `${root.name} · Auto step ${k + 1} · ${stamp} #${seq.id}-${Date.now().toString(36)}`,
        userId: root.userId,
        sendType: "followup",
        status: "sending",
        parentCampaignId: root.id,
        bodyHtml: step.bodyHtml,
        subject: "[]",
        pitchIds: "[]",
        fromAccountIds: JSON.stringify(accountIds),
        customLimits: root.customLimits,
        senderRole: root.senderRole,
        sequenceId: seq.id,
        sequenceStep: k + 1,
        totalRecipients: claimed.length,
      },
      select: { id: true },
    });
    await tx.campaignRecipient.createMany({
      data: claimed.map((c) => ({
        campaignId: campaign.id,
        email: c.email,
        accountId: Number(c.accountId),
        status: "pending",
      })),
      skipDuplicates: true,
    });
    await tx.sequenceEnrollment.updateMany({
      where: { id: { in: claimed.map((c) => Number(c.id)) } },
      data: { lastCampaignId: campaign.id },
    });
    accountIds.forEach((a) => busy.add(a));
    return { campaignId: campaign.id, step: k + 1, count: claimed.length };
  });
}

/**
 * Worker job: advance every active sequence.
 * @returns {Promise<Array<{ sequenceId: number, step: number, count: number, campaignId: number }>>}
 */
export async function runSequences() {
  const sequences = await prisma.followupSequence.findMany({ where: { status: "active" } });
  const queued = [];
  if (!sequences.length) return queued;

  const busy = await busyAccountIds();

  for (const seq of sequences) {
    try {
      const [steps, root] = await Promise.all([
        prisma.sequenceStep.findMany({ where: { sequenceId: seq.id }, orderBy: { position: "asc" } }),
        prisma.campaign.findUnique({
          where: { id: seq.campaignId },
          select: { id: true, name: true, userId: true, customLimits: true, senderRole: true, status: true },
        }),
      ]);
      if (!steps.length || !root) continue;

      await enrollNew(seq, steps[0]);
      await stopFinished(seq);

      for (let k = 0; k < steps.length; k++) {
        const r = await queueStep(seq, root, steps, k, busy);
        if (r) {
          queued.push({ sequenceId: seq.id, ...r });
          console.log(`🔁 Sequence ${seq.id}: step ${r.step} queued for ${r.count} recipient(s) (campaign ${r.campaignId})`);
        }
      }
      await prisma.followupSequence.update({ where: { id: seq.id }, data: { lastRunAt: new Date() } });
    } catch (err) {
      if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(err?.code)) throw err;
      console.error(`❌ Sequence ${seq.id} run failed:`, err.message);
    }
  }
  return queued;
}

/** Stop all active people in a sequence (pause keeps them; archive stops them). */
export async function stopAllEnrollments(sequenceId, reason) {
  const r = await prisma.sequenceEnrollment.updateMany({
    where: { sequenceId, status: "active" },
    data: { status: "stopped", stoppedReason: reason, nextDueAt: null },
  });
  return r.count;
}
