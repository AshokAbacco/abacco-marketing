-- ════════════════════════════════════════════════════════════════════════════
-- Performance indexes — run BEFORE `npx prisma db push`
--
-- Why a manual file:
--   `prisma db push` builds indexes with a plain CREATE INDEX, which blocks
--   writes on the table for the whole build. On large CampaignRecipient /
--   EmailMessage tables that stalls sending. CONCURRENTLY builds without
--   blocking writes.
--
-- How to run (psql, NOT inside a transaction — CONCURRENTLY forbids that):
--   psql "$DATABASE_URL" -f prisma/manual/2026_09_perf_indexes.sql
--
-- Then:
--   npx prisma db push      → sees identical names, has nothing left to do
--   npx prisma generate
--
-- Index names match Prisma's default naming, so Prisma treats them as its own.
-- Every statement is idempotent (IF [NOT] EXISTS) and safe to re-run.
-- If a CONCURRENTLY build is interrupted it leaves an INVALID index; the
-- DROP ... IF EXISTS lines at the bottom of each section let you re-run cleanly.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Campaign ────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Campaign_status_idx"
  ON "Campaign" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Campaign_status_scheduledAt_idx"
  ON "Campaign" ("status", "scheduledAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Campaign_userId_createdAt_idx"
  ON "Campaign" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Campaign_parentCampaignId_idx"
  ON "Campaign" ("parentCampaignId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Campaign_sendType_status_idx"
  ON "Campaign" ("sendType", "status");

-- ── CampaignRecipient ───────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CampaignRecipient_campaignId_accountId_status_id_idx"
  ON "CampaignRecipient" ("campaignId", "accountId", "status", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CampaignRecipient_status_updatedAt_idx"
  ON "CampaignRecipient" ("status", "updatedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CampaignRecipient_accountId_idx"
  ON "CampaignRecipient" ("accountId");
-- Redundant: prefix of the unique (campaignId, email) and (campaignId, status)
DROP INDEX CONCURRENTLY IF EXISTS "CampaignRecipient_campaignId_idx";

-- ── EmailMessage ────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailMessage_emailAccountId_toEmail_sentAt_idx"
  ON "EmailMessage" ("emailAccountId", "toEmail", "sentAt");

-- ── Conversation ────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_emailAccountId_lastMessageAt_idx"
  ON "Conversation" ("emailAccountId", "lastMessageAt");
DROP INDEX CONCURRENTLY IF EXISTS "Conversation_emailAccountId_idx";

-- ── ScheduledMessage ────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ScheduledMessage_status_sendAt_idx"
  ON "ScheduledMessage" ("status", "sendAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ScheduledMessage_userId_idx"
  ON "ScheduledMessage" ("userId");

-- ── SyncState ───────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SyncState_accountId_folder_idx"
  ON "SyncState" ("accountId", "folder");
DROP INDEX CONCURRENTLY IF EXISTS "SyncState_accountId_idx";

-- ── Lead ────────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Lead_userId_createdAt_idx"
  ON "Lead" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Lead_email_idx"
  ON "Lead" ("email");

-- ── PitchTemplate ───────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PitchTemplate_userId_idx"
  ON "PitchTemplate" ("userId");

-- ── DailyEmailLog ───────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DailyEmailLog_sentAt_idx"
  ON "DailyEmailLog" ("sentAt");
-- Duplicate of the unique (userId, sentAt) constraint's own index
DROP INDEX CONCURRENTLY IF EXISTS "DailyEmailLog_userId_sentAt_idx";

-- ── Refresh planner statistics so the new indexes are used immediately ─────
ANALYZE "Campaign";
ANALYZE "CampaignRecipient";
ANALYZE "EmailMessage";
ANALYZE "Conversation";
ANALYZE "SyncState";
ANALYZE "DailyEmailLog";

-- ── Verify: this should return zero rows (no half-built indexes) ───────────
SELECT c.relname AS invalid_index
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE NOT i.indisvalid;
