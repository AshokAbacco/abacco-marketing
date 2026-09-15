// server/src/utils/campaignScheduler.js
//
// Moves due "scheduled" campaigns to "sending". Runs in the worker only.
// The worker's resume tick (every ~10 s) starts the actual send loop, so
// there is exactly ONE code path that starts sending.

import cron from "node-cron";
import prisma from "../prismaClient.js";

let running = false;
let task = null;

async function tick(isPaused) {
  if (running || isPaused()) return;
  running = true;

  try {
    // One atomic statement: flips every due campaign and returns which ones.
    // Replaces two full-table reads (one loading every column incl. the HTML
    // body) plus one UPDATE per campaign.
    const started = await prisma.$queryRaw`
      UPDATE "Campaign"
      SET "status" = 'sending'
      WHERE "status" = 'scheduled'
        AND "scheduledAt" IS NOT NULL
        AND "scheduledAt" <= NOW()
      RETURNING "id", "name"
    `;

    for (const c of started) {
      console.log(
        `⏰ Scheduled campaign ${c.id} ("${c.name}") is due — queued for sending`,
      );
    }
  } catch (err) {
    console.error("❌ Scheduler error:", err.message);
  } finally {
    running = false;
  }
}

/**
 * @param {{ isPaused?: () => boolean }} [opts]
 *        isPaused lets the worker skip ticks during shutdown / DB outages.
 */
export function startCampaignScheduler({ isPaused = () => false } = {}) {
  if (task) return task;

  // Every minute: the query is a single indexed UPDATE, and scheduled
  // campaigns now start within ~1 minute instead of up to 2.
  task = cron.schedule("* * * * *", () => tick(isPaused));
  console.log("⏰ Campaign scheduler started (every minute)");
  return task;
}

export function stopCampaignScheduler() {
  task?.stop();
  task = null;
}
