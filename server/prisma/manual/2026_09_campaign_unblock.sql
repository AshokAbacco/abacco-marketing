-- prisma/manual/2026_09_campaign_unblock.sql
--
-- One-time fix for campaigns that "paused and never started again".
-- Safe to run more than once.   npm run db:unblock
--
-- 1. New columns used by the worker for self-expiring mailbox cooldowns.
ALTER TABLE "EmailAccount" ADD COLUMN IF NOT EXISTS "sendingCooldownUntil"  TIMESTAMP(3);
ALTER TABLE "EmailAccount" ADD COLUMN IF NOT EXISTS "sendingCooldownReason" TEXT;

-- 2. Clear the AUTOMATIC mailbox pauses the old engine created (bounce rate,
--    provider quota, login failure). They never expired on their own for
--    login failures and silently froze every campaign using the mailbox.
--    Pauses an admin set by hand on the Deliverability page are kept.
UPDATE "EmailAccount"
SET "sendingPausedAt" = NULL, "sendingPausedReason" = NULL, "sendingPausedUntil" = NULL
WHERE "sendingPausedAt" IS NOT NULL
  AND (   "sendingPausedReason" LIKE 'High bounce rate%'
       OR "sendingPausedReason" LIKE 'Provider sending limit%'
       OR "sendingPausedReason" LIKE 'Login failed%');

-- 3. Campaigns stuck in "paused" (set by the old automatic startup code, never
--    by a user) that still have recipients → back to "sending". Campaigns a
--    USER paused ("stopped") are left alone — they resume with Resend.
UPDATE "CampaignRecipient" r
SET "status" = 'pending', "updatedAt" = NOW()
FROM "Campaign" c
WHERE r."campaignId" = c."id"
  AND c."status" = 'paused'
  AND r."status" = 'processing';

UPDATE "Campaign" c
SET "status" = 'sending', "error" = NULL
WHERE c."status" = 'paused'
  AND EXISTS (SELECT 1 FROM "CampaignRecipient" r
              WHERE r."campaignId" = c."id" AND r."status" = 'pending');

-- 4. Nothing left to send → completed.
UPDATE "Campaign" c
SET "status" = 'completed'
WHERE c."status" = 'paused'
  AND NOT EXISTS (SELECT 1 FROM "CampaignRecipient" r
                  WHERE r."campaignId" = c."id" AND r."status" IN ('pending', 'processing'));

-- 5. Report
SELECT "status", count(*) FROM "Campaign" GROUP BY 1 ORDER BY 1;