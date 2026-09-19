// scripts/hashUserPasswords.js
//
// Converts every remaining plain-text user password to a bcrypt hash.
// (Users are also converted automatically when they next log in — this
// script just finishes the job for people who haven't.)
//
//   node scripts/hashUserPasswords.js            # dry run
//   node scripts/hashUserPasswords.js --apply    # write changes
//
// Existing sessions stay valid; users keep their current password.

import "dotenv/config";

const APPLY = process.argv.includes("--apply");
process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "script";
process.env.PRISMA_POOL_SIZE = process.env.PRISMA_POOL_SIZE || "2";

const { default: prisma } = await import("../src/prismaClient.js");
const { hashPassword, isPasswordHash } = await import("../src/controllers/userController.js");

const users = await prisma.user.findMany({ select: { id: true, email: true, password: true } });
let plain = 0, updated = 0, changed = 0;

for (const u of users) {
  if (isPasswordHash(u.password)) continue;
  plain++;
  if (!APPLY) {
    console.log(`would hash password for ${u.email}`);
    continue;
  }
  const res = await prisma.user.updateMany({
    where: { id: u.id, password: u.password },
    data:  { password: await hashPassword(u.password) },
  });
  if (res.count) updated++; else changed++;
}

console.log(`\n${users.length} users, ${plain} with plain-text passwords` +
  (APPLY ? `, ${updated} hashed${changed ? `, ${changed} changed meanwhile (skipped)` : ""}` : ""));
if (!APPLY) console.log("Dry run only — re-run with --apply to write changes.");
await prisma.$disconnect();
