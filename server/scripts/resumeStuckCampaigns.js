// server/scripts/resumeStuckCampaigns.js
//
// ONE-TIME recovery script for campaigns that stalled mid-send because of
// the DB connection-pool exhaustion bug (fixed in this same change: multiple
// files were using an unbounded, unpooled Prisma client alongside the
// properly pooled one, which starved Postgres of connections and caused
// "Timed out fetching a new connection" errors mid-campaign).
//
// The normal recovery jobs in worker.js (recoverStuckEmails,
// resumeSendingCampaignsSafe) would eventually fix this on their own within
// a couple of minutes of redeploying — this script just does it immediately
// instead of waiting for the 3-minute stuck threshold to elapse, and prints
// a summary so you can see exactly what it did.
//
// Usage (from server/, with the same env as worker.js — needs DATABASE_URL
// and SMTP account credentials to actually send):
//   node scripts/resumeStuckCampaigns.js
//
// Safe to run more than once — everything here is idempotent (it only
// touches rows that are actually "processing"/"pending" under a "sending"
// campaign).

import "dotenv/config";
import prisma from "../src/prismaClient.js";
import { sendBulkCampaign } from "../src/services/campaignMailer.service.js";

async function main() {
  console.log("🔍 Looking for campaigns marked \"sending\"...");

  const sendingCampaigns = await prisma.campaign.findMany({
    where:  { status: "sending" },
    select: { id: true, name: true },
  });

  if (sendingCampaigns.length === 0) {
    console.log("✅ No campaigns are currently marked \"sending\". Nothing to do.");
    return;
  }

  console.log(`📋 Found ${sendingCampaigns.length} campaign(s) in "sending" state:`);
  sendingCampaigns.forEach(c => console.log(`   - #${c.id} ${c.name}`));

  for (const c of sendingCampaigns) {
    // Unstick any recipient currently sitting in "processing" for this
    // campaign — these are the ones whose worker died mid-send when the
    // account's status/batch query threw. We don't need the normal 3-minute
    // safety window here because we already know (from the bug we just
    // fixed) that these are stale, not actively in flight.
    const unstuck = await prisma.campaignRecipient.updateMany({
      where:  { campaignId: c.id, status: "processing" },
      data: {
        status:    "pending",
        error:     "Manually recovered after connection-pool fix",
        updatedAt: new Date(),
      },
    });

    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId: c.id, status: { in: ["pending", "processing"] } },
    });

    console.log(
      `♻️  Campaign #${c.id}: reset ${unstuck.count} stuck recipient(s) → pending. ` +
      `${remaining} recipient(s) still remaining overall.`
    );

    if (remaining === 0) {
      console.log(`ℹ️  Campaign #${c.id} has nothing left to send — leaving status as-is.`);
      continue;
    }

    console.log(`🚀 Resuming campaign #${c.id}...`);
    // Not awaited sequentially on purpose past this point isn't needed here
    // since we DO want to await each one fully so this script's own
    // Prisma connection isn't juggling many campaigns' worth of sends at
    // once — this script runs once, not on a timer.
    await sendBulkCampaign(c.id).catch(err =>
      console.error(`❌ Campaign #${c.id} resume error:`, err.message)
    );
    console.log(`✅ Campaign #${c.id} resume pass complete.`);
  }

  console.log("🏁 Done. Re-check each campaign's progress in the UI.");
}

main()
  .catch(err => {
    console.error("❌ Script error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });