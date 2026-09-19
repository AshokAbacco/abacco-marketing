// src/middlewares/authMiddleware.js
import jwt from "jsonwebtoken";
import prisma, { isDbUnavailableError } from "../prismaClient.js";
import cache, { getOrSet } from "../utils/cache.js";

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH MIDDLEWARE

   1. JWT problems        → 401 (frontend logs out — correct)
   2. Database problems   → 503 (frontend retries, user stays logged in)

   PERFORMANCE: `protect` runs on EVERY API request, and several screens
   poll every few seconds. It used to run prisma.user.findUnique each time,
   which alone was dozens of queries per second with a handful of users.
   The user row is now cached for USER_CACHE_TTL seconds, and concurrent
   requests for the same user share one lookup.

   When a user is edited, deactivated or deleted, userController calls
   invalidateUserCache(id) so the change applies immediately in the API
   process.
═══════════════════════════════════════════════════════════════════════════ */

const USER_CACHE_TTL = Number(process.env.USER_CACHE_TTL) || 60; // seconds

const userCacheKey = (id) => `authUser:${id}`;

export function invalidateUserCache(userId) {
  if (userId) cache.del(userCacheKey(userId));
}

async function loadUser(userId) {
  return getOrSet(userCacheKey(userId), USER_CACHE_TTL, () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        empId: true,
        jobRole: true,
        isActive: true,
        passwordChangedAt: true,
      },
    }),
  );
}

function extractBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export const protect = async (req, res, next) => {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: "Not authorized, no token" });
  }

  // ── Step 1: verify the token. Only THIS can produce a 401. ──────────────
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }

  if (!decoded?.id) {
    return res.status(401).json({ error: "Invalid token" });
  }

  // ── Step 2: load the user (cached). Failures here are infrastructure. ──
  let user;
  try {
    user = await loadUser(decoded.id);
  } catch (err) {
    if (isDbUnavailableError(err)) {
      console.error(
        "[protect] Database unavailable:",
        err.code || "",
        err.message?.split("\n").pop(),
      );
      res.set("Retry-After", "5");
      return res.status(503).json({
        error: "Service temporarily unavailable. Please retry.",
        retryable: true,
      });
    }
    console.error("[protect] Unexpected error loading user:", err);
    return res.status(500).json({ error: "Server error" });
  }

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  if (
    user.passwordChangedAt &&
    decoded.iat &&
    decoded.iat < Math.floor(new Date(user.passwordChangedAt).getTime() / 1000)
  ) {
    return res.status(401).json({
      error: "Your password was changed. Please log in again.",
    });
  }

  // Deactivated users are logged out on their next request (the frontend
  // interceptor treats "inactive" as a real auth failure).
  if (user.isActive === false) {
    return res
      .status(401)
      .json({ error: "Your account is inactive. Please contact admin." });
  }

  req.user = user;
  next();
};

/**
 * Lightweight JWT check with no DB query.
 * Useful for quick verification routes or socket auth.
 */
export const verifyToken = (req, res, next) => {
  const token = extractBearer(req);
  if (!token) {
    return res
      .status(401)
      .json({ message: "Authorization token missing or invalid" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
};

export function isAdminOrHr(user) {
  const role = String(user?.jobRole || "")
    .trim()
    .toLowerCase();
  return role === "admin" || role === "hr";
}

/**
 * Requires an admin/HR role. Must run AFTER `protect`.
 */
export const requireAdmin = (req, res, next) => {
  if (!isAdminOrHr(req.user)) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
};

/**
 * Logout handler.
 * There is no Session model in schema.prisma (JWTs are stateless), so this
 * simply acknowledges the logout; the client discards its token.
 */
export const logoutSession = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized - user not found" });
  }
  return res
    .status(200)
    .json({ success: true, message: "Logged out successfully" });
};
