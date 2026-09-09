import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";

/* ═══════════════════════════════════════════════════════════════════════════
   WHY THIS FILE CHANGED

   The old `protect` wrapped BOTH jwt.verify() and prisma.user.findUnique()
   in a single try/catch that returned 401 "Token failed" for any error.

   A Prisma pool timeout is a DATABASE error, not an auth error — but it
   came back as 401. The frontend interceptor in api.js treats every 401 as
   an expired session, so it cleared localStorage and redirected to login.

   Net effect: whenever the connection pool was saturated, everyone using the
   site got logged out. Their token was perfectly valid the whole time.

   Now: JWT problems → 401 (log out, correct).
        Database problems → 503 (retry later, stay logged in).
═══════════════════════════════════════════════════════════════════════════ */

const DB_ERROR_CODES = new Set([
  "P1001", // can't reach database
  "P1002", // database timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024", // TIMED OUT FETCHING A CONNECTION FROM THE POOL  ← the one you hit
]);

function isInfrastructureError(err) {
  if (!err) return false;
  if (DB_ERROR_CODES.has(err.code)) return true;

  const msg = String(err.message || "");
  return (
    msg.includes("Timed out fetching a new connection") ||
    msg.includes("Server has closed the connection") ||
    msg.includes("recovery mode") ||
    msg.includes("not yet accepting connections") ||
    msg.includes("Can't reach database server")
  );
}

export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

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

  // ── Step 2: load the user. Failures here are infrastructure, not auth. ──
  try {
    req.user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, empId: true, jobRole: true },
    });
  } catch (err) {
    if (isInfrastructureError(err)) {
      console.error("[protect] Database unavailable:", err.message);
      res.set("Retry-After", "5");
      return res.status(503).json({
        error: "Service temporarily unavailable. Please retry.",
        retryable: true,
      });
    }
    console.error("[protect] Unexpected error loading user:", err);
    return res.status(500).json({ error: "Server error" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "User not found" });
  }

  next();
};

/**
 * Lightweight JWT check with no DB query.
 * Useful for quick verification routes or socket auth.
 */
export const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "Authorization token missing or invalid" });
    }

    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Token expired" });
    if (err.name === "JsonWebTokenError")
      return res.status(401).json({ message: "Invalid token format" });

    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Requires an admin/HR role. The app has role data but never enforced it
 * server-side — every check was client-side only.
 */
export const requireAdmin = (req, res, next) => {
  const role = String(req.user?.jobRole || "").trim().toLowerCase();
  if (role !== "admin" && role !== "hr") {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
};

/**
 * Logout handler.
 * NOTE: this references prisma.session, but there is no Session model in
 * schema.prisma — calling it throws. Left as-is to avoid changing behaviour;
 * either add the model or remove the route.
 */
export const logoutSession = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized - user not found" });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    await prisma.session.delete({ where: { id: parseInt(sessionId, 10) } });

    return res
      .status(200)
      .json({ success: true, message: "Session logged out successfully" });
  } catch (err) {
    console.error("[logoutSession] Error:", err);
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    }
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};