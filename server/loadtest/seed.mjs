// loadtest/seed.mjs
//
// Creates load-test users, sender accounts (pointing at Mailpit) and API
// tokens. Safe to re-run: existing load-test rows are reused.
//
//   node --env-file=loadtest/.env.loadtest loadtest/seed.mjs --accounts=20 --users=25
//
//   --accounts  sender mailboxes for the main test user   (default 20)
//   --users     extra users for API load (each gets a token) (default 25)

import jwt from "jsonwebtoken";
import { assertSafeDatabase, arg, saveState, getPrisma } from "./lib.mjs";

assertSafeDatabase();

const ACCOUNTS = arg("accounts", 20);
const USERS = arg("users", 25);
const SMTP_HOST = process.env.LT_SMTP_HOST || "localhost";
const SMTP_PORT = Number(process.env.LT_SMTP_PORT || 1025);

if (!process.env.JWT_SECRET) {
  console.error("⛔ JWT_SECRET missing — use --env-file=loadtest/.env.loadtest");
  process.exit(1);
}

const prisma = await getPrisma(3);
const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

async function upsertUser(email, name, jobRole) {
  return prisma.user.upsert({
    where:  { email },
    update: { isActive: true, jobRole },
    create: { email, name, jobRole, password: "loadtest", isActive: true },
    select: { id: true, email: true },
  });
}

try {
  await prisma.$queryRaw`SELECT 1`;
} catch (err) {
  console.error("⛔ Cannot reach the database. Is `docker compose -f loadtest/docker-compose.yml up -d` running?");
  console.error("  ", err.message.split("\n").pop());
  process.exit(1);
}

console.log(`🌱 Seeding: 1 sender user with ${ACCOUNTS} accounts, ${USERS} API users`);

// Main user: owns the sender accounts and the campaigns. Admin so the
// admin endpoints can be load-tested too.
const main = await upsertUser("lt-main@loadtest.local", "LT Main", "admin");

const accountIds = [];
for (let i = 1; i <= ACCOUNTS; i++) {
  const email = `lt-sender-${String(i).padStart(3, "0")}@loadtest.local`;
  const acc = await prisma.emailAccount.upsert({
    where:  { email },
    update: { userId: main.id, smtpHost: SMTP_HOST, smtpPort: SMTP_PORT, deleted: false, verified: false },
    create: {
      email,
      userId:        main.id,
      provider:      "custom",
      smtpHost:      SMTP_HOST,
      smtpPort:      SMTP_PORT,
      smtpUser:      email,
      imapHost:      null,
      encryptedPass: "loadtest",       // plain value; Mailpit accepts any login
      senderName:    `LT Sender ${i}`,
      // verified:false keeps the IMAP sync from trying to log in to these.
      verified:      false,
      deleted:       false,
    },
    select: { id: true },
  });
  accountIds.push(acc.id);
}

const users = [{ id: main.id, email: main.email, token: token(main.id) }];
for (let i = 1; i <= USERS; i++) {
  const u = await upsertUser(`lt-user-${String(i).padStart(3, "0")}@loadtest.local`, `LT User ${i}`, "Employee");
  users.push({ id: u.id, email: u.email, token: token(u.id) });
}

saveState({
  createdAt: new Date().toISOString(),
  mainUserId: main.id,
  mainToken: users[0].token,
  accountIds,
  users,
  campaignIds: [],
});

console.log(`✅ Seeded. main user=${main.id}, accounts=${accountIds.length}, users=${users.length}`);
console.log("   State written to loadtest/.state.json (tokens valid 7 days)");
await prisma.$disconnect();
