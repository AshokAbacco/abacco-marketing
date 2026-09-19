import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "x";
await import("@prisma/client");
await import("nodemailer");
const db = globalThis.__db;
const prisma = (await import(`${new URL("../src/", import.meta.url).pathname}prismaClient.js`)).default;
const { runSync } = await import(`${new URL("../src/", import.meta.url).pathname}services/imap.service.js`);
db.user.push({ id: "u1", email: "u@x", name: "U" });
db.emailAccount.push({ id: 1, userId: "u1", email: "alice@gmail.com", imapHost: "imap.test", imapPort: 993, encryptedPass: "pw", verified: true, deleted: false, smtpHost: "x" });
db.campaign.push({ id: 10, userId: "u1", status: "completed", sendType: "immediate" });
const sentAt = new Date(Date.now() - 3600e3);
db.campaignRecipient.push(
  { id: 100, campaignId: 10, email: "lead@t.com", status: "sent", accountId: 1, sentAt, sentFromEmail: "alice@gmail.com", retryCount: 0 },
  { id: 101, campaignId: 10, email: "dead@t.com", status: "sent", accountId: 1, sentAt, sentFromEmail: "alice@gmail.com", retryCount: 0 },
);
const hdr = (h) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\r\n");
globalThis.__imapMessages = [
  { uid: 1, messageId: "<r1@t.com>", raw: Buffer.from(hdr({ From: "lead@t.com", To: "alice@gmail.com", Subject: "Re: hi", "Message-ID": "<r1@t.com>", "In-Reply-To": "<campaign-10-100@gmail.com>", Date: new Date().toUTCString() }) + "\r\n\r\nYes, interested!\r\n") },
  { uid: 2, messageId: "<b1@mx>", raw: Buffer.from(hdr({ From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", To: "alice@gmail.com", Subject: "Delivery Status Notification (Failure)", "Message-ID": "<b1@mx>", "X-Failed-Recipients": "dead@t.com", Date: new Date().toUTCString() }) + "\r\n\r\nAddress not found. 550 5.1.1 does not exist\r\nX-Abacco-Campaign: 10-101\r\n") },
  // Our own campaign copy in the mailbox must be skipped before download
  { uid: 3, messageId: "<campaign-10-100@gmail.com>", raw: Buffer.from("should never be downloaded") },
];
await runSync(prisma);
assert.equal(db.emailMessage.length, 2, "reply + bounce stored, campaign copy skipped");
assert.ok(db.campaignRecipient[0].repliedAt, "reply detected through the sync");
assert.equal(db.replyEvent[0].conversationId, db.emailMessage[0].conversationId);
assert.equal(db.campaignRecipient[1].bounceType, "hard");
assert.equal(db.suppressedEmail[0].email, "dead@t.com");
// second sync: nothing new, nothing reprocessed
await runSync(prisma);
assert.equal(db.emailMessage.length, 2);
assert.equal(db.replyEvent.length, 1);
assert.equal(db.emailBounce.length, 1);
console.log("IMAP HOOK OK");
process.exit(0);
