// server/src/utils/campaignScheduler.js
//
// Moves due "scheduled" campaigns to "sending". Runs in the worker only.
// The worker's resume tick (every ~5 s) calls activateDueCampaigns() and
// then starts the send loop, so a scheduled campaign begins within seconds
// of its start time. The once-a-minute cron below is only a safety net.

import cron from "node-cron";
import prisma from "../prismaClient.js";

let running = false;
let task = null;

/**
 * Flip every due "scheduled" campaign to "sending" (one atomic, indexed
 * UPDATE). Safe to call often and from several places.
 * @returns {Promise<{id:number,name:string}[]>} the campaigns just started
 */
export async function activateDueCampaigns() {
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
  return started;
}

async function tick(isPaused) {
  if (running || isPaused()) return;
  running = true;
  try {
    await activateDueCampaigns();
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

  // Safety net only — the worker's resume tick normally starts due
  // campaigns within a few seconds.
  task = cron.schedule("* * * * *", () => tick(isPaused));
  console.log("⏰ Campaign scheduler started (every minute, plus every resume tick)");
  return task;
}

export function stopCampaignScheduler() {
  task?.stop();
  task = null;
}