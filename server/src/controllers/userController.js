// src/controllers/userController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";


const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};


export const registerUser = async (req, res) => {
  try {
    const { email, password, empId, name, jobRole, location } = req.body;

    if (!email || !password || !name || !jobRole) {
      return res.status(400).json({
        error: "All fields are required",
      });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
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
        isActive: true
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
    console.error("Register error:", err);
    res.status(500).json({ error: err.message });
  }
};


export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // ✅ Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        jobRole: true,
        empId: true,
        password: true,
        isActive: true,
      }
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // 🔍 DEBUG: Log user data
    console.log("===== LOGIN DEBUG =====");
    console.log("User found:", email);
    console.log("User ID:", user.id);
    console.log("User name:", user.name);
    console.log("User jobRole:", user.jobRole);
    console.log("User isActive:", user.isActive);
    console.log("Type of isActive:", typeof user.isActive);
    console.log("======================");

    // ✅ Check if account is active
    if (user.isActive === false || user.isActive === 0 || user.isActive === "false" || user.isActive === "0" || !user.isActive) {
      console.log("❌ User account is inactive");
      return res.status(403).json({
        error: "Your account is inactive. Please contact admin.",
      });
    }

    console.log("✅ Account is active");

    // ✅ Password check (plain text comparison)
    const isMatch = password === user.password;
    if (!isMatch) {
      console.log("❌ Password mismatch");
      return res.status(400).json({ error: "Invalid email or password" });
    }

    console.log("✅ Password matched");

    // ✅ Generate JWT token
    const token = generateToken(user.id);

    console.log("✅ Token generated, sending response");
    console.log("Response will include:");
    console.log("- id:", user.id);
    console.log("- email:", user.email);
    console.log("- name:", user.name);
    console.log("- jobRole:", user.jobRole);

    // ✅ CRITICAL: Return ALL user fields at root level
    // This ensures frontend receives complete user data
    res.json({
      token,
      id: user.id,
      email: user.email,
      name: user.name || email.split('@')[0],           // ✅ Fallback to email prefix if name is null
      jobRole: String(user.jobRole || "user").trim(),   // ✅ Ensure it's always a string, default to "user"
      empId: user.empId,
      message: "Login successful",
    });

    console.log("✅ Response sent successfully");

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
      name: user.name || user.email.split('@')[0],
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
        createdAt: 'desc'
      }
    });

    // ✅ Format users for frontend
    const formattedUsers = users.map(user => ({
      ...user,
      jobRole: String(user.jobRole || "user").trim(),
      name: user.name || user.email.split('@')[0],
    }));

    res.json(formattedUsers);
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({ error: err.message });
  }
};


export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }

    const { name, email, password, empId, jobRole, location } = req.body;

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
      });

      if (emailExists) {
        return res.status(400).json({ error: "Email already in use by another user" });
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
      }
    });

    console.log("✅ User updated:", user.email);

    res.json({
      message: "User updated successfully",
      user: {
        ...user,
        jobRole: String(user.jobRole || "user").trim(),
      },
    });
  } catch (error) {
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
      }
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ Find all email accounts belonging to this user
    const emailAccounts = await prisma.emailAccount.findMany({
      where: { userId: id },
      select: { id: true }
    });

    const emailAccountIds = emailAccounts.map(acc => acc.id);

    // ✅ Delete related records in correct order (to respect foreign key constraints)
    if (emailAccountIds.length > 0) {
      // 1. Delete all email messages associated with these email accounts
      await prisma.emailMessage.deleteMany({
        where: {
          emailAccountId: { in: emailAccountIds }
        }
      });
      console.log(`🗑️ Deleted email messages for ${emailAccountIds.length} email account(s)`);

      // 2. Delete all email accounts
      await prisma.emailAccount.deleteMany({
        where: { userId: id }
      });
      console.log(`🗑️ Deleted ${emailAccountIds.length} email account(s)`);
    }

    // 3. Delete any other related records (add more if needed based on your schema)
    // Example: If you have other tables with userId foreign key
    // await prisma.otherTable.deleteMany({ where: { userId: id } });

    // 4. Finally, delete the user
    await prisma.user.delete({ where: { id } });

    console.log("✅ User deleted:", existingUser.email);

    res.json({ 
      message: "User and all related data deleted successfully",
      deletedUser: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
      }
    });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: err.message });
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
      }
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
      }
    });

    console.log(`✅ User status toggled: ${updatedUser.email} - isActive: ${updatedUser.isActive}`);

    res.json({
      message: `User ${updatedUser.isActive ? 'activated' : 'deactivated'} successfully`,
      user: {
        ...updatedUser,
        jobRole: String(updatedUser.jobRole || "user").trim(),
      }
    });
  } catch (err) {
    console.error("Toggle status error:", err);
    res.status(500).json({ error: err.message });
  }
};