// server/src/utils/crypto.js
//
// Encryption for stored mailbox (IMAP/SMTP) passwords.
//
// FORMATS IN THE DATABASE (EmailAccount.encryptedPass)
//   v2:<ivHex>:<cipherHex>   current — key from MAILBOX_ENCRYPTION_KEY
//   <ivHex>:<cipherHex>      legacy  — key that used to be hard-coded here
//   anything else            plain text (older rows saved before encryption)
//
// resolveSecret() reads all three, so nothing breaks while old rows exist.
// `node scripts/rotateMailboxKey.js` converts every row to v2.
//
// KEY: set MAILBOX_ENCRYPTION_KEY to 32 random bytes, written as either
//   64 hex characters    →  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   44-char base64
// Keep it secret and backed up — without it stored passwords can't be read.

import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

// The key that was committed to the repository. Kept ONLY to read rows that
// were encrypted with it; never used to write when a real key is configured.
const LEGACY_KEY = Buffer.from("your-super-secret-key-32-chars!!", "utf8");

const V2_RE = /^v2:([0-9a-f]{32}):([0-9a-f]+)$/i;
const LEGACY_RE = /^([0-9a-f]{32}):([0-9a-f]+)$/i;

function parseKey(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const b64 = Buffer.from(value, "base64");
    if (b64.length === 32 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return b64;
  } catch {
    /* not base64 */
  }
  if (Buffer.byteLength(value, "utf8") === 32)
    return Buffer.from(value, "utf8");
  throw new Error(
    "MAILBOX_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, 44-char base64, or a 32-character string",
  );
}

const CURRENT_KEY = parseKey(process.env.MAILBOX_ENCRYPTION_KEY);

if (!CURRENT_KEY) {
  console.warn(
    "⚠️  MAILBOX_ENCRYPTION_KEY is not set — mailbox passwords are encrypted with the " +
      "legacy key that is visible in the source code. Set a real key (see utils/crypto.js).",
  );
} else if (CURRENT_KEY.equals(LEGACY_KEY)) {
  console.warn(
    "⚠️  MAILBOX_ENCRYPTION_KEY equals the old public key — generate a new one.",
  );
}

function aesEncrypt(key, text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const out = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  return { iv: iv.toString("hex"), data: out.toString("hex") };
}

function aesDecrypt(key, ivHex, dataHex) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, "hex"),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a configured (non-legacy) key is available. */
export function hasEncryptionKey() {
  return Boolean(CURRENT_KEY);
}

/** Which storage format a value is in: "v2" | "legacy" | "plain" | "empty". */
export function secretFormat(stored) {
  if (stored === null || stored === undefined || stored === "") return "empty";
  if (V2_RE.test(stored)) return "v2";
  if (LEGACY_RE.test(stored)) return "legacy";
  return "plain";
}

/**
 * Encrypt a secret for storage. Uses the configured key (v2 format), or the
 * legacy format if no key is configured yet.
 */
export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === "") return plain;
  if (CURRENT_KEY) {
    const { iv, data } = aesEncrypt(CURRENT_KEY, plain);
    return `v2:${iv}:${data}`;
  }
  const { iv, data } = aesEncrypt(LEGACY_KEY, plain);
  return `${iv}:${data}`;
}

/**
 * Turn whatever is stored into the usable password.
 * Returns null for empty values. Throws only if a v2 value can't be
 * decrypted (wrong/missing key) — that is a configuration error worth
 * surfacing, not something to silently send as a password.
 */
export function resolveSecret(stored) {
  const format = secretFormat(stored);
  if (format === "empty") return null;

  if (format === "v2") {
    if (!CURRENT_KEY) {
      throw new Error(
        "Stored password uses the v2 format but MAILBOX_ENCRYPTION_KEY is not set",
      );
    }
    const [, iv, data] = stored.match(V2_RE);
    return aesDecrypt(CURRENT_KEY, iv, data);
  }

  if (format === "legacy") {
    const [, iv, data] = stored.match(LEGACY_RE);
    try {
      return aesDecrypt(LEGACY_KEY, iv, data);
    } catch {
      // Not actually legacy ciphertext — a plain password that happens to
      // look like hex:hex. Use it as-is.
      return stored;
    }
  }

  return stored;
}

/* ── Backward-compatible names (older imports) ─────────────────────────── */
export const encrypt = (text) => encryptSecret(text);
export const decrypt = (value) => resolveSecret(value);
