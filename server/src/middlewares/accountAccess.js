// src/middlewares/accountAccess.js
//
// Mailbox ownership checks. A user may only touch mailboxes they own;
// Admin/HR may access every mailbox (manager oversight).
//
// Responses use 404 (not 403) so IDs of other users' mailboxes can't be
// discovered by probing.

import prisma from "../prismaClient.js";
import { getOrSet } from "../utils/cache.js";
import cache from "../utils/cache.js";
import { isAdminOrHr } from "./authMiddleware.js";

const OWNED_TTL = 30; // seconds
const ownedKey = (userId) => `ownedAccounts:${userId}`;

async function ownedAccountIds(userId) {
  const ids = await getOrSet(ownedKey(userId), OWNED_TTL, async () => {
    const rows = await prisma.emailAccount.findMany({
      where:  { userId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  });
  return new Set(ids || []);
}

/** Call after an account is created, deleted or re-assigned. */
export function invalidateOwnedAccounts(userId) {
  if (userId) cache.del(ownedKey(userId));
}

export async function canAccessAccount(user, accountId) {
  const id = Number(accountId);
  if (!user || !Number.isInteger(id) || id <= 0) return false;
  if ((await ownedAccountIds(user.id)).has(id)) return true;
  if (isAdminOrHr(user)) {
    const exists = await prisma.emailAccount.findUnique({ where: { id }, select: { id: true } });
    return Boolean(exists);
  }
  return false;
}

/** Keep only the account ids the user may access. */
export async function filterAccessibleAccountIds(user, accountIds) {
  const ids = [...new Set((accountIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!user || !ids.length) return [];
  if (isAdminOrHr(user)) return ids;
  const owned = await ownedAccountIds(user.id);
  return ids.filter((id) => owned.has(id));
}

/** Mailbox a conversation belongs to (or null). */
export async function conversationAccountId(conversationId) {
  if (!conversationId || typeof conversationId !== "string") return null;
  const conv = await prisma.conversation.findUnique({
    where:  { id: conversationId },
    select: { emailAccountId: true },
  });
  if (conv) return conv.emailAccountId;
  const msg = await prisma.emailMessage.findFirst({
    where:  { conversationId },
    select: { emailAccountId: true },
  });
  return msg?.emailAccountId ?? null;
}

export async function canAccessConversation(user, conversationId) {
  const accountId = await conversationAccountId(conversationId);
  return accountId ? canAccessAccount(user, accountId) : false;
}

/**
 * Express middleware factory. `pick(req)` returns the account id to check.
 *   router.get("/x/:id", protect, requireAccountAccess((req) => req.params.id), handler)
 */
export function requireAccountAccess(pick) {
  return async (req, res, next) => {
    try {
      const id = pick(req);
      if (!(await canAccessAccount(req.user, id))) {
        return res.status(404).json({ success: false, message: "Account not found" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireConversationAccess(pick) {
  return async (req, res, next) => {
    try {
      if (!(await canAccessConversation(req.user, pick(req)))) {
        return res.status(404).json({ success: false, message: "Conversation not found" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Remove secrets before an account row leaves the server. */
export function sanitizeAccount(account) {
  if (!account || typeof account !== "object") return account;
  const {
    encryptedPass, oauthClientSecret, refreshToken, accessToken, ...safe
  } = account;
  return { ...safe, hasPassword: Boolean(encryptedPass) };
}
