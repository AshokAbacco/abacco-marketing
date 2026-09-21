// loadtest/reset.mjs
//
// Clears load-test results so the next run starts clean:
//   • deletes all load-test campaigns (recipients cascade) and their Sent records
//   • empties Mailpit (needed for an exact duplicate check)
//   • keeps the seeded users/accounts and tokens
//
//   node --env-file=loadtest/.env.loadtest loadtest/reset.mjs          # results only
//   node --env-file=loadtest/.env.loadtest loadtest/reset.mjs --all    # also users/accounts + state file

import fs from "node:fs";
import { assertSafeDatabase, getPrisma, STATE_FILE } from "./lib.mjs";

assertSafeDatabase();

const ALL = process.argv.includes("--all");
const MAILPIT = process.env.LT_MAILPIT_API || "http://localhost:8025";
const prisma = await getPrisma(2);

const mainUser = await prisma.user.findUnique({
  where: { email: "lt-main@loadtest.local" },
  select: { id: true },
});

if (mainUser) {
  // Campaigns first (recipients cascade), in chunks to keep statements short.
  const campaigns = await prisma.campaign.findMany({ where: { userId: mainUser.id }, select: { id: true } });
  await prisma.campaign.updateMany({
    where: { parentCampaignId: { in: campaigns.map(c => c.id) } },
    data:  { parentCampaignId: null },
  });
  for (const c of campaigns) {
    await prisma.campaign.delete({ where: { id: c.id } }).catch(() => {});
  }

  const accounts = await prisma.emailAccount.findMany({ where: { userId: mainUser.id }, select: { id: true } });
  const accIds = accounts.map(a => a.id);
  const msgs = await prisma.emailMessage.deleteMany({ where: { emailAccountId: { in: accIds } } });
  await prisma.conversation.deleteMany({ where: { emailAccountId: { in: accIds } } });
  await prisma.dailyEmailLog.deleteMany({ where: { userId: mainUser.id } });

  console.log(`🧹 Removed ${campaigns.length} campaigns and ${msgs.count} sent records`);
}

if (ALL) {
  const del = await prisma.user.deleteMany({ where: { email: { endsWith: "@loadtest.local" } } });
  console.log(`🧹 Removed ${del.count} load-test users (and their accounts)`);
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
} else if (fs.existsSync(STATE_FILE)) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  state.campaignIds = [];
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

try {
  const r = await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  console.log(r.ok ? "🧹 Mailpit emptied" : `⚠️ Mailpit delete returned HTTP ${r.status}`);
} catch {
  console.log("⚠️ Mailpit not reachable — empty it from http://localhost:8025 before the next run");
}

// Reset query statistics so the next summary shows only the next run.
await prisma.$executeRaw`SELECT pg_stat_statements_reset()`.catch(() => {});
await prisma.$disconnect();
console.log("✅ Reset done");
