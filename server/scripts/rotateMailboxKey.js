// scripts/rotateMailboxKey.js
//
// Re-encrypts every stored mailbox password with MAILBOX_ENCRYPTION_KEY
// (v2 format). Converts legacy-encrypted AND plain-text rows.
//
//   node scripts/rotateMailboxKey.js            # dry run — shows what would change
//   node scripts/rotateMailboxKey.js --apply    # writes the changes
//
// Safe to re-run: rows already in v2 format are skipped. Each row is
// updated only if its value hasn't changed since it was read.
//
// BEFORE --apply: back up the database and store the new key safely.
// AFTER  --apply: the API and worker MUST run with the same key.

import "dotenv/config";

const APPLY = process.argv.includes("--apply");

if (!process.env.MAILBOX_ENCRYPTION_KEY) {
  console.error("⛔ MAILBOX_ENCRYPTION_KEY is not set. Generate one with:");
  console.error("   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "script";
process.env.PRISMA_POOL_SIZE = process.env.PRISMA_POOL_SIZE || "2";

const { default: prisma } = await import("../src/prismaClient.js");
const { encryptSecret, resolveSecret, secretFormat } = await import("../src/utils/crypto.js");

const BATCH = 200;
const counts = { v2: 0, legacy: 0, plain: 0, empty: 0, updated: 0, changedMeanwhile: 0, failed: 0 };

let lastId = 0;
for (;;) {
  const rows = await prisma.emailAccount.findMany({
    where:   { id: { gt: lastId } },
    orderBy: { id: "asc" },
    take:    BATCH,
    select:  { id: true, email: true, encryptedPass: true },
  });
  if (!rows.length) break;
  lastId = rows[rows.length - 1].id;

  for (const row of rows) {
    const format = secretFormat(row.encryptedPass);
    counts[format]++;
    if (format === "v2" || format === "empty") continue;

    let plain;
    try {
      plain = resolveSecret(row.encryptedPass);
    } catch (err) {
      counts.failed++;
      console.error(`❌ ${row.email}: cannot read current value (${err.message})`);
      continue;
    }

    const next = encryptSecret(plain);
    if (resolveSecret(next) !== plain) {
      counts.failed++;
      console.error(`❌ ${row.email}: round-trip check failed — skipped`);
      continue;
    }

    if (!APPLY) {
      console.log(`would convert ${row.email} (${format} → v2)`);
      continue;
    }

    const res = await prisma.emailAccount.updateMany({
      where: { id: row.id, encryptedPass: row.encryptedPass },
      data:  { encryptedPass: next },
    });
    if (res.count === 1) counts.updated++;
    else counts.changedMeanwhile++;
  }
}

console.log("\nSummary:", counts);
if (!APPLY) console.log("Dry run only — re-run with --apply to write changes.");
await prisma.$disconnect();
