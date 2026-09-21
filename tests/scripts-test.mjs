import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
process.env.JWT_SECRET = "x";
await import("@prisma/client");
const db = globalThis.__db;
// Import once WITHOUT a key to produce legacy-format ciphertext.
const legacy = await import("../src/utils/crypto.js?legacy=1");
db.user.push({ id: "a", email: "a@x", password: "plain-one" }, { id: "b", email: "b@x", password: "$2a$10$" + "a".repeat(53) });
db.emailAccount.push(
  { id: 1, email: "p@x", encryptedPass: "plain-app-pw" },
  { id: 2, email: "l@x", encryptedPass: legacy.encrypt("legacy-pw") },
  { id: 3, email: "e@x", encryptedPass: null },
);
process.env.MAILBOX_ENCRYPTION_KEY = "c".repeat(64);
process.argv.push("--apply");
await import(`${new URL("../scripts/", import.meta.url).pathname}hashUserPasswords.js`);
assert.match(db.user[0].password, /^\$2[aby]\$10\$/);
assert.equal(db.user[1].password, "$2a$10$" + "a".repeat(53));
const bcrypt = (await import("bcryptjs")).default;
assert.ok(await bcrypt.compare("plain-one", db.user[0].password));
await import(`${new URL("../scripts/", import.meta.url).pathname}rotateMailboxKey.js`);
const { resolveSecret, secretFormat } = await import(`${new URL("../src/", import.meta.url).pathname}utils/crypto.js`);
assert.deepEqual(db.emailAccount.map(a => secretFormat(a.encryptedPass)), ["v2", "v2", "empty"]);
assert.equal(resolveSecret(db.emailAccount[0].encryptedPass), "plain-app-pw");
assert.equal(resolveSecret(db.emailAccount[1].encryptedPass), "legacy-pw");
console.log("SCRIPTS OK");
