// server/worker.js
import prisma from "./src/prisma.js";
import { runSync } from "./src/services/imap.service.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";

console.log("🟢 Worker running");

// IMAP sync every 1 minute
setInterval(() => {
  runSync(prisma).catch((err) =>
    console.error("❌ IMAP sync error:", err)
  );
}, 60 * 1000);

// Campaign scheduler (Immediate + Scheduled)
startCampaignScheduler();
