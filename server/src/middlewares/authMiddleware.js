// src/middlewares/authMiddleware.js 
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";

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

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, empId: true },
    });

    if (!req.user) {
      return res.status(401).json({ error: "User not found" });
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: "Token failed" });
  }
};


/**
 * Middleware: Lightweight JWT check only (no DB query)
 * Useful for quick verification routes or socket auth
 */
export const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("[verifyToken] Auth Header:", authHeader);

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[verifyToken] ❌ Missing Bearer token");
      return res
        .status(401)
        .json({ message: "Authorization token missing or invalid" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    console.log("[verifyToken] ✅ Token verified for user ID:", decoded.id);
    next();
  } catch (err) {
    console.error("[verifyToken] ❌ JWT verification error:", err.message);

    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Token expired" });
    if (err.name === "JsonWebTokenError")
      return res.status(401).json({ message: "Invalid token format" });

    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Logout handler: deletes session from DB
 * (optional feature if you track sessions)
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

    await prisma.session.delete({
      where: { id: parseInt(sessionId, 10) },
    });

    return res
      .status(200)
      .json({ success: true, message: "Session logged out successfully" });
  } catch (err) {
    console.error("[logoutSession] ❌ Error logging out session:", err);

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
