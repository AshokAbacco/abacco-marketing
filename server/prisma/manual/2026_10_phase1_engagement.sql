-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1 — replies, bounces, suppression, security
--
-- Run BEFORE `npx prisma db push`:
--   psql "$DATABASE_URL" -f prisma/manual/2026_10_phase1_engagement.sql
--
-- Everything is additive and idempotent (safe to re-run):
--   • new nullable columns (instant in PostgreSQL, no table rewrite)
--   • three new empty tables
--   • indexes on the big CampaignRecipient table built CONCURRENTLY
-- Names match Prisma's conventions, so `prisma db push` afterwards finds
-- nothing left to change.
-- Must NOT run inside a transaction (CONCURRENTLY forbids it) — psql -f is fine.
-- ════════════════════════════════════════════════════════════════════════════

-- ── New columns ─────────────────────────────────────────────────────────────
ALTER TABLE "User"              ADD COLUMN IF NOT EXISTS "passwordChangedAt"   TIMESTAMP(3);

ALTER TABLE "EmailAccount"      ADD COLUMN IF NOT EXISTS "sendingPausedAt"     TIMESTAMP(3);
ALTER TABLE "EmailAccount"      ADD COLUMN IF NOT EXISTS "sendingPausedReason" TEXT;
ALTER TABLE "EmailAccount"      ADD COLUMN IF NOT EXISTS "sendingPausedUntil"  TIMESTAMP(3);

ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "repliedAt"      TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "bouncedAt"      TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "bounceType"     TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "unsubscribedAt" TIMESTAMP(3);

-- ── New tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SuppressedEmail" (
    "id"         SERIAL       NOT NULL,
    "email"      TEXT         NOT NULL,
    "reason"     TEXT         NOT NULL,
    "source"     TEXT,
    "note"       TEXT,
    "campaignId" INTEGER,
    "accountId"  INTEGER,
    "addedById"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuppressedEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SuppressedEmail_email_key"            ON "SuppressedEmail" ("email");
CREATE INDEX        IF NOT EXISTS "SuppressedEmail_reason_createdAt_idx" ON "SuppressedEmail" ("reason", "createdAt");
CREATE INDEX        IF NOT EXISTS "SuppressedEmail_createdAt_idx"        ON "SuppressedEmail" ("createdAt");

CREATE TABLE IF NOT EXISTS "EmailBounce" (
    "id"          SERIAL       NOT NULL,
    "email"       TEXT         NOT NULL,
    "accountId"   INTEGER      NOT NULL,
    "campaignId"  INTEGER,
    "recipientId" INTEGER,
    "type"        TEXT         NOT NULL,
    "statusCode"  TEXT,
    "diagnostic"  TEXT,
    "messageId"   TEXT         NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailBounce_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailBounce_accountId_messageId_key" ON "EmailBounce" ("accountId", "messageId");
CREATE INDEX        IF NOT EXISTS "EmailBounce_email_createdAt_idx"     ON "EmailBounce" ("email", "createdAt");
CREATE INDEX        IF NOT EXISTS "EmailBounce_accountId_createdAt_idx" ON "EmailBounce" ("accountId", "createdAt");

CREATE TABLE IF NOT EXISTS "ReplyEvent" (
    "id"             SERIAL       NOT NULL,
    "email"          TEXT         NOT NULL,
    "fromEmail"      TEXT,
    "accountId"      INTEGER      NOT NULL,
    "campaignId"     INTEGER,
    "recipientId"    INTEGER,
    "messageId"      TEXT         NOT NULL,
    "conversationId" TEXT,
    "subject"        TEXT,
    "snippet"        TEXT,
    "intent"         TEXT         NOT NULL DEFAULT 'reply',
    "matchedBy"      TEXT         NOT NULL,
    "receivedAt"     TIMESTAMP(3) NOT NULL,
    "reviewStatus"   TEXT,
    "reviewedAt"     TIMESTAMP(3),
    "reviewedById"   TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplyEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReplyEvent_accountId_messageId_key"  ON "ReplyEvent" ("accountId", "messageId");
CREATE INDEX        IF NOT EXISTS "ReplyEvent_email_receivedAt_idx"     ON "ReplyEvent" ("email", "receivedAt");
CREATE INDEX        IF NOT EXISTS "ReplyEvent_accountId_receivedAt_idx" ON "ReplyEvent" ("accountId", "receivedAt");
CREATE INDEX        IF NOT EXISTS "ReplyEvent_reviewStatus_createdAt_idx" ON "ReplyEvent" ("reviewStatus", "createdAt");
CREATE INDEX        IF NOT EXISTS "ReplyEvent_campaignId_idx"           ON "ReplyEvent" ("campaignId");

-- ── Big-table indexes (non-blocking) ────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CampaignRecipient_accountId_sentAt_idx"
  ON "CampaignRecipient" ("accountId", "sentAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CampaignRecipient_email_sentAt_idx"
  ON "CampaignRecipient" ("email", "sentAt");
-- Superseded by (accountId, sentAt), which serves the same lookups.
DROP INDEX CONCURRENTLY IF EXISTS "CampaignRecipient_accountId_idx";

ANALYZE "CampaignRecipient";

-- Verify: should return zero rows.
SELECT c.relname AS invalid_index
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE NOT i.indisvalid;
