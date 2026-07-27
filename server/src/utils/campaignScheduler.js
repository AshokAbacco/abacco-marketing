// server/src/utils/campaignScheduler.js

import cron from "node-cron";
import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";

export function startCampaignScheduler() {
  console.log("⏰ Campaign scheduler started");

  // Run every minute
  cron.schedule("* * * * *", async () => {
    console.log("\n==========================================");
    console.log("⏰ Scheduler Tick");
    console.log("Server Time:", new Date().toISOString());
    console.log("==========================================");

    try {
      // Show current scheduled campaigns
      const scheduled = await prisma.campaign.findMany({
        where: {
          status: "scheduled",
        },
        select: {
          id: true,
          name: true,
          status: true,
          scheduledAt: true,
        },
      });

      console.log(`📊 Scheduled campaigns in DB: ${scheduled.length}`);

      scheduled.forEach((c) => {
        console.log({
          id: c.id,
          name: c.name,
          status: c.status,
          scheduledAt: c.scheduledAt,
        });
      });

      // Find campaigns that should start now
      const dueCampaigns = await prisma.campaign.findMany({
        where: {
          status: "scheduled",
          scheduledAt: {
            lte: new Date(),
          },
        },
      });

      console.log(`📋 Due campaigns found: ${dueCampaigns.length}`);

      if (dueCampaigns.length === 0) {
        console.log("ℹ️ No campaigns are due yet.");
        return;
      }

      for (const campaign of dueCampaigns) {
        console.log(`🚀 Processing Campaign ID: ${campaign.id}`);

        // Atomic lock
        const updated = await prisma.campaign.updateMany({
          where: {
            id: campaign.id,
            status: "scheduled",
          },
          data: {
            status: "sending",
          },
        });

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

        sendBulkCampaign(campaign.id)
          .then(() => {
            console.log(
              `✅ sendBulkCampaign finished successfully for ${campaign.id}`
            );
          })
          .catch((err) => {
            console.error(
              `❌ sendBulkCampaign failed for ${campaign.id}`
            );
            console.error(err);
          });
      }
    } catch (err) {
      console.error("❌ Scheduler Error");
      console.error(err);
    }
  });
}