// src/controllers/userController.js
//
// PASSWORDS
//   New and changed passwords are stored as bcrypt hashes.
//   Older rows still hold plain text; on the user's next successful login
//   the password is re-saved as a hash automatically ("lazy migration"),
//   so nobody has to reset anything. `node scripts/hashUserPasswords.js`
//   converts all remaining plain-text rows at once.
//   Admins can no longer view passwords — they reset them instead, which
//   also ends every existing session of that user.

import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { invalidateUserCache } from "../middlewares/authMiddleware.js";
import { reassignCrmOwnership } from "../services/crm.service.js";

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;
const MIN_PASSWORD_LENGTH = Number(process.env.MIN_PASSWORD_LENGTH) || 8;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// Compared against when the user doesn't exist, so response time doesn't
// reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync(
  crypto.randomBytes(16).toString("hex"),
  BCRYPT_ROUNDS,
);

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

export const isPasswordHash = (value) =>
  typeof value === "string" && BCRYPT_RE.test(value);

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

function validateNewPassword(password) {
  if (typeof password !== "string" || !password.trim())
    return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return "Password is too long";
  return null;
}

/** Constant-time check for legacy plain-text rows. */
function plainEquals(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function verifyPassword(user, password) {
  if (!user) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    return { ok: false, needsUpgrade: false };
  }
  if (isPasswordHash(user.password)) {
    return {
      ok: await bcrypt.compare(String(password), user.password),
      needsUpgrade: false,
    };
  }
  const ok = plainEquals(password, user.password);
  return { ok, needsUpgrade: ok };
}

const formatRole = (role) => String(role || "user").trim();

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTER  (Admin/HR — see routes/user.js)
═══════════════════════════════════════════════════════════════════════════ */
export const registerUser = async (req, res) => {
  try {
    const { password, empId, name, jobRole, location } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password || !name || !jobRole) {
      return res.status(400).json({ error: "All fields are required" });
    }
    const pwError = validateNewPassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const exists = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (exists) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        passwordChangedAt: new Date(),
        empId: empId || null,
        name,
        jobRole,
        location,
        isActive: true,
      },
      select: { id: true, email: true, empId: true, name: true, jobRole: true },
    });

    res.status(201).json(user);
  } catch (err) {
    if (err.code === "P2002") {
      return res
        .status(400)
        .json({ error: "Email or Employee ID already exists" });
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error during registration" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   LOGIN  (rate-limited — see routes/user.js)
═══════════════════════════════════════════════════════════════════════════ */
export const loginUser = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    const { password } = req.body;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const select = {
      id: true,
      email: true,
      name: true,
      jobRole: true,
      empId: true,
      password: true,
      isActive: true,
    };

    // Exact match uses the unique index. The case-insensitive fallback only
    // runs on a miss, for accounts created before emails were lower-cased.
    const user =
      (await prisma.user.findUnique({ where: { email }, select })) ||
      (await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select,
      }));

    const { ok, needsUpgrade } = await verifyPassword(user, password);

    // Same message for "no user" and "wrong password" — don't reveal which.
    if (!ok) {
      req.loginAttempt?.fail();
      return res.status(400).json({ error: "Invalid email or password" });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: "Your account is inactive. Please contact admin.",
      });
    }

    req.loginAttempt?.succeed();

    if (needsUpgrade) {
      // Lazy migration: replace the plain-text value with a hash. Only if it
      // is still the same value we just checked (no concurrent change).
      // passwordChangedAt is NOT touched, so existing sessions stay valid.
      try {
        await prisma.user.updateMany({
          where: { id: user.id, password: user.password },
          data: { password: await hashPassword(password) },
        });
      } catch (err) {
        console.error(
          "Password upgrade failed (login still succeeds):",
          err.message,
        );
      }
    }

    return res.json({
      token: generateToken(user.id),
      id: user.id,
      email: user.email,
      name: user.name || user.email.split("@")[0],
      jobRole: formatRole(user.jobRole),
      empId: user.empId,
      message: "Login successful",
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CURRENT USER
═══════════════════════════════════════════════════════════════════════════ */
export const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized - No user ID found" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        jobRole: true,
        location: true,
        empId: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name || user.email.split("@")[0],
      jobRole: formatRole(user.jobRole),
      empId: user.empId,
      location: user.location,
      isActive: user.isActive,
    });
  } catch (err) {
    console.error("Get current user error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   LIST USERS  (Admin/HR) — passwords are never returned
═══════════════════════════════════════════════════════════════════════════ */
export const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        empId: true,
        name: true,
        email: true,
        jobRole: true,
        location: true,
        isActive: true,
        passwordChangedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      users.map((user) => ({
        ...user,
        jobRole: formatRole(user.jobRole),
        name: user.name || user.email.split("@")[0],
      })),
    );
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE USER  (Admin/HR) — optional new password
═══════════════════════════════════════════════════════════════════════════ */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }

    const { name, password, empId, jobRole, location } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : undefined;

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        empId: true,
        jobRole: true,
        location: true,
      },
    });
    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (emailExists) {
        return res
          .status(400)
          .json({ error: "Email already in use by another user" });
      }
    }

    const data = {
      name: name || existingUser.name,
      email: email || existingUser.email,
      empId: empId || existingUser.empId,
      jobRole: jobRole || existingUser.jobRole,
      location: location || existingUser.location,
    };

    // Only change the password if a new one was typed.
    if (typeof password === "string" && password.trim() !== "") {
      const pwError = validateNewPassword(password);
      if (pwError) return res.status(400).json({ error: pwError });
      data.password = await hashPassword(password);
      data.passwordChangedAt = new Date();
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        jobRole: true,
        location: true,
        empId: true,
        isActive: true,
      },
    });

    invalidateUserCache(id);

    res.json({
      message: "User updated successfully",
      passwordChanged: Boolean(data.password),
      user: { ...user, jobRole: formatRole(user.jobRole) },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ error: "Email or Employee ID already in use" });
    }
    console.error("Update user error:", error);
    res.status(500).json({ error: "Server error during update" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   RESET PASSWORD  (Admin/HR)
   PUT /api/users/:id/password  { password }
   Logs the user out everywhere (tokens issued before now are rejected).
═══════════════════════════════════════════════════════════════════════════ */
export const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};

    const pwError = validateNewPassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const exists = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: "User not found" });

    await prisma.user.update({
      where: { id },
      data: {
        password: await hashPassword(password),
        passwordChangedAt: new Date(),
      },
    });

    invalidateUserCache(id);
    res.json({
      success: true,
      message:
        "Password reset. The user must log in again with the new password.",
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CHANGE OWN PASSWORD  (any logged-in user)
   PUT /api/users/me/password  { currentPassword, newPassword }
═══════════════════════════════════════════════════════════════════════════ */
export const changeOwnPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const pwError = validateNewPassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, password: true },
    });
    const { ok } = await verifyPassword(user, currentPassword || "");
    if (!ok) {
      req.loginAttempt?.fail();
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const changedAt = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(newPassword),
        passwordChangedAt: changedAt,
      },
    });
    invalidateUserCache(user.id);

    // Other sessions end; this one gets a fresh token.
    res.json({ success: true, token: generateToken(user.id) });
  } catch (err) {
    console.error("Change own password error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE USER  (Admin/HR)
═══════════════════════════════════════════════════════════════════════════ */
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }
    if (id === req.user?.id) {
      return res
        .status(400)
        .json({ error: "You cannot delete your own account" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true },
    });
    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // EmailAccount, Campaign, Lead, ScheduledMessage, EmailAccountGroup all
    // cascade from User in schema.prisma. EmailMessage cascades from
    // EmailAccount. Tags do NOT cascade, so remove them explicitly.
    // CRM records (contacts, companies, deals, open tasks) are handed to the
    // admin doing the deletion — customer history must not disappear.
    const reassigned = await prisma.$transaction(async (tx) => {
      const moved = await reassignCrmOwnership(id, req.user.id, tx);
      await tx.tag.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
      return moved;
    });

    invalidateUserCache(id);

    res.json({
      message: "User and all related data deleted successfully",
      deletedUser: existingUser,
      reassignedToYou: reassigned,
    });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Server error during delete" });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVATE / DEACTIVATE  (Admin/HR)
═══════════════════════════════════════════════════════════════════════════ */
export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }
    if (id === req.user?.id) {
      return res
        .status(400)
        .json({ error: "You cannot deactivate your own account" });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        email: true,
        name: true,
        jobRole: true,
        empId: true,
        isActive: true,
      },
    });

    invalidateUserCache(id);

    res.json({
      message: `User ${updatedUser.isActive ? "activated" : "deactivated"} successfully`,
      // Top-level copy: the Users page reads res.data.isActive.
      isActive: updatedUser.isActive,
      user: { ...updatedUser, jobRole: formatRole(updatedUser.jobRole) },
    });
  } catch (err) {
    console.error("Toggle status error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
