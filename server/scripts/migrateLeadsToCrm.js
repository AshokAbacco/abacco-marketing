// scripts/migrateLeadsToCrm.js
//
// One-time (and re-runnable) conversion of existing Leads into CRM
// contacts, companies and pipeline deals.
//
//   node scripts/migrateLeadsToCrm.js                 # dry run: counts only
//   node scripts/migrateLeadsToCrm.js --apply         # contacts + companies + deals
//   node scripts/migrateLeadsToCrm.js --apply --no-deals
//
// For each lead (oldest first):
//   • one Contact per client address (Lead.fromEmail, else Lead.email);
//     the owner is the employee who captured the FIRST lead for it
//   • a Company from the website / business email domain (free-mail
//     domains like gmail.com are skipped)
//   • a "Lead captured" timeline entry, dated when the lead was created
//   • one open Deal per contact in the CRM_LEAD_DEAL_STAGE stage
//     (default "Interested"), unless the contact already has an open deal
//
// Idempotent: every entry carries an external key, so re-running only
// adds what is missing.

import "dotenv/config";

const APPLY = process.argv.includes("--apply");
const WITH_DEALS = !process.argv.includes("--no-deals");
const BATCH = 200;

process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "script";
process.env.PRISMA_POOL_SIZE = process.env.PRISMA_POOL_SIZE || "2";

const { default: prisma } = await import("../src/prismaClient.js");
const crm = await import("../src/services/crm.service.js");

const stats = { leads: 0, noEmail: 0, contactsCreated: 0, linked: 0, dealsCreated: 0, failed: 0 };
const seenEmails = new Set();

let lastId = 0;
for (;;) {
  const leads = await prisma.lead.findMany({
    where: { id: { gt: lastId } },
    orderBy: { id: "asc" },
    take: BATCH,
  });
  if (!leads.length) break;
  lastId = leads[leads.length - 1].id;

  for (const lead of leads) {
    stats.leads++;
    const email = crm.normalizeEmail(lead.fromEmail) || crm.normalizeEmail(lead.email);
    if (!email) { stats.noEmail++; continue; }

    if (!APPLY) {
      if (!seenEmails.has(email)) {
        seenEmails.add(email);
        const exists = await prisma.contact.findUnique({ where: { email }, select: { id: true } });
        if (!exists) stats.contactsCreated++;
      }
      if (lead.contactId === null || lead.contactId === undefined) stats.linked++;
      continue;
    }

    try {
      const r = await crm.syncLeadToCrm(lead, { withDeal: WITH_DEALS });
      if (!r) { stats.noEmail++; continue; }
      if (r.contactCreated) stats.contactsCreated++;
      if (lead.contactId !== r.contact.id) stats.linked++;
      if (r.deal) stats.dealsCreated++;
    } catch (err) {
      stats.failed++;
      console.error(`❌ lead ${lead.id} (${email}): ${err.message}`);
    }
  }
  console.log(`… processed ${stats.leads} leads`);
}

console.log("\nSummary:", stats);
if (!APPLY) {
  console.log("Dry run: 'contactsCreated' = new contacts that would be created; 'linked' = leads that would be linked.");
  console.log("Run again with --apply to write changes" + (WITH_DEALS ? " (add --no-deals to skip pipeline deals)." : "."));
}
await prisma.$disconnect();
