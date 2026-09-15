// src/controllers/userController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { invalidateUserCache } from "../middlewares/authMiddleware.js";

// ⚠ SECURITY NOTE: passwords are stored and compared in plain text because
// the admin Users page displays them. Move to bcrypt (already a dependency)
// and drop the "show password" feature as soon as the business allows it.

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

export const registerUser = async (req, res) => {
  try {
    const { password, empId, name, jobRole, location } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password || !name || !jobRole) {
      return res.status(400).json({
        error: "All fields are required",
      });
    }

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
        password: password,
        empId,
        name,
        jobRole,
        location,
        isActive: true,
      },
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      empId: user.empId,
      name: user.name,
      jobRole: user.jobRole,
    });
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

export const loginUser = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    const { password } = req.body;

    if (!email || !password) {
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

    // Same message for "no user" and "wrong password" — don't reveal which.
    if (!user || typeof password !== "string" || password !== user.password) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: "Your account is inactive. Please contact admin.",
      });
    }

    const token = generateToken(user.id);

    return res.json({
      token,
      id: user.id,
      email: user.email,
      name: user.name || user.email.split("@")[0],
      jobRole: String(user.jobRole || "user").trim(),
      empId: user.empId,
      message: "Login successful",
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
};

// ✅ NEW: Get current logged-in user details
export const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user?.id; // From auth middleware

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

    // ✅ Return user data with proper formatting
    res.json({
      id: user.id,
      email: user.email,
      name: user.name || user.email.split("@")[0],
      jobRole: String(user.jobRole || "user").trim(),
      empId: user.empId,
      isActive: user.isActive,
    });
  } catch (err) {
    console.error("Get current user error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

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
        password: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // ✅ Format users for frontend
    const formattedUsers = users.map((user) => ({
      ...user,
      jobRole: String(user.jobRole || "user").trim(),
      name: user.name || user.email.split("@")[0],
    }));

    res.json(formattedUsers);
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }

    const { name, password, empId, jobRole, location } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : undefined;

    // ✅ Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ Check if email is being changed and if it's already taken
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

    // ✅ Only update password if a new one is provided
    let updatedPassword = existingUser.password;
    if (password && password.trim() !== "") {
      updatedPassword = password.trim();
    }

    // ✅ Update user
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: name || existingUser.name,
        email: email || existingUser.email,
        empId: empId || existingUser.empId,
        jobRole: jobRole || existingUser.jobRole,
        location: location || existingUser.location,
        password: updatedPassword,
      },
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
      user: {
        ...user,
        jobRole: String(user.jobRole || "user").trim(),
      },
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

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }

    // ✅ Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // EmailAccount, Campaign, Lead, ScheduledMessage, EmailAccountGroup all
    // cascade from User in schema.prisma. EmailMessage cascades from
    // EmailAccount. Tags do NOT cascade, so remove them explicitly.
    // One transaction: either everything goes or nothing does.
    await prisma.$transaction([
      prisma.tag.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);

    invalidateUserCache(id);

    res.json({
      message: "User and all related data deleted successfully",
      deletedUser: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
      },
    });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Server error during delete" });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }

    // ✅ Find user
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ Toggle isActive status
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isActive: !user.isActive,
      },
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
      user: {
        ...updatedUser,
        jobRole: String(updatedUser.jobRole || "user").trim(),
      },
    });
  } catch (err) {
    console.error("Toggle status error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
