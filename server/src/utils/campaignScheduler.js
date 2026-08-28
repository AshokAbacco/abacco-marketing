// server/src/utils/campaignScheduler.js

import cron from "node-cron";
import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";

// ✅ Retry helper (SAFE)
const retryOperation = async (fn, retries = 3, delay = 2000) => {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;

    console.log(`🔁 Retrying... (${retries} left)`);
    await new Promise((res) => setTimeout(res, delay));

    return retryOperation(fn, retries - 1, delay);
  }
};

export function startCampaignScheduler() {
  console.log("⏰ Campaign scheduler started");

  // ✅ Run every 2 minutes (reduced load)
  cron.schedule("*/2 * * * *", async () => {
    console.log("\n==========================================");
    console.log("⏰ Scheduler Tick");
    console.log("Server Time:", new Date().toISOString());
    console.log("==========================================");

    try {
      // ✅ Fetch scheduled campaigns
      const scheduled = await retryOperation(() =>
        prisma.campaign.findMany({
          where: {
            status: "Scheduled", // ✅ FIXED CASE
          },
          select: {
            id: true,
            name: true,
            status: true,
            scheduledAt: true,
          },
        })
      );

      console.log(`📊 Scheduled campaigns in DB: ${scheduled.length}`);

      // ✅ Find campaigns that should start now
      const dueCampaigns = await retryOperation(() =>
        prisma.campaign.findMany({
          where: {
            status: "Scheduled", // ✅ FIXED CASE
            scheduledAt: {
              lte: new Date(),
            },
          },
        })
      );

      console.log(`📋 Due campaigns found: ${dueCampaigns.length}`);

      if (dueCampaigns.length === 0) {
        console.log("ℹ️ No campaigns are due yet.");
        return;
      }

      // ✅ Process campaigns ONE BY ONE (safe)
      for (const campaign of dueCampaigns) {
        console.log(`🚀 Processing Campaign ID: ${campaign.id}`);

        // 🔒 Lock campaign (atomic)
        const updated = await retryOperation(() =>
          prisma.campaign.updateMany({
            where: {
              id: campaign.id,
              status: "Scheduled", // ✅ FIXED CASE
            },
            data: {
              status: "Sending", // ✅ FIXED CASE
            },
          })
        );

        console.log(
          `🔒 Lock Result for Campaign ${campaign.id}: ${updated.count}`
        );

        if (updated.count === 0) {
          console.log(
            `⚠️ Campaign ${campaign.id} already picked by another worker.`
          );
          continue;
        }

        console.log(`📤 Starting sendBulkCampaign(${campaign.id})`);

        // ✅ Retry campaign sending
        retryOperation(() => sendBulkCampaign(campaign.id))
          .then(() => {
            console.log(
              `✅ Campaign ${campaign.id} finished successfully`
            );
          })
          .catch(async (err) => {
            console.error(
              `❌ Campaign ${campaign.id} failed after retries`
            );
            console.error(err);

            // ❗ Optional: mark campaign as failed
            await prisma.campaign.update({
              where: { id: campaign.id },
              data: { status: "Failed" },
            });
          });
      }
    } catch (err) {
      console.error("❌ Scheduler Error");
      console.error(err);
    }
  });
}