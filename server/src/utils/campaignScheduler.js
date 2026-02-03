// server/src/utils/campaignScheduler.js
import cron from "node-cron";
import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";

export function startCampaignScheduler() {
  console.log("⏰ Campaign scheduler started");

  // Runs every minute
  cron.schedule("* * * * *", async () => {
    try {
      const dueCampaigns = await prisma.campaign.findMany({
        where: {
          status: "scheduled",
          scheduledAt: {
            lte: new Date(),
          },
        },
      });

      for (const campaign of dueCampaigns) {
        console.log("📤 Sending campaign:", campaign.id);

        // Lock campaign (prevents duplicate execution)
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "sending" },
        });

        try {
          // Send emails
          await sendBulkCampaign(campaign.id);

          // Mark completed
          await prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: "completed" },
          });

          console.log("✅ Campaign completed:", campaign.id);
        } catch (sendErr) {
          console.error("❌ Campaign failed:", campaign.id, sendErr);

          await prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: "failed" },
          });
        }
      }
    } catch (err) {
      console.error("❌ Campaign scheduler error:", err);
    }
  });
}
