// src/controllers/userController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prisma.js";


const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};


export const registerUser = async (req, res) => {
  try {
    const { email, password, empId, name, jobRole } = req.body;

    if (!email || !password || !name || !jobRole) {
      return res.status(400).json({
        error: "All fields are required",
      });
    }

  const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ error: "User already exists" });

    const user = await prisma.user.create({
        data: {
            email,
            password: password,
            empId,
            name,
            jobRole,
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
            res.status(500).json({ error: err.message });
        }
        };



export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // 🔍 DEBUG: Log everything about the user
    console.log("===== LOGIN DEBUG =====");
    console.log("Full user object:", JSON.stringify(user, null, 2));
    console.log("Email:", email);
    console.log("User isActive value:", user.isActive);
    console.log("Type of isActive:", typeof user.isActive);
    console.log("======================");

    // ⚠️ TEMPORARILY DISABLED - COMMENT OUT THE isActive CHECK FOR TESTING
    /*
    if (user.isActive === false || user.isActive === 0 || user.isActive === "false" || user.isActive === "0" || !user.isActive) {
      console.log("❌ User blocked: isActive check failed");
      return res.status(403).json({
        error: "Your account is inactive. Please contact admin.",
      });
    }
    */

    console.log("✅ isActive check BYPASSED for testing");

    // ✅ Password check (plain text comparison)
    const isMatch = password === user.password;
    if (!isMatch) {
      console.log("❌ Password mismatch");
      return res.status(400).json({ error: "Invalid email or password" });
    }

    console.log("✅ Password matched");

    // ✅ Generate JWT token
    const token = generateToken(user.id);

    console.log("✅ Sending success response with role:", user.jobRole);

    // ✅ Return token and user data at root level
    res.json({
      token,
      id: user.id,
      email: user.email,
      name: user.name,
      jobRole: user.jobRole,
      message: "Login successful",
    });
  } catch (err) {
    console.error("Login error:", err);
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
        password: true,
        isActive: true,
      },
    });

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "User ID is missing" });
    }

    const { name, email, password, empId, jobRole } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    let updatedPassword = existingUser.password;

    if (password && password.trim() !== "") {
      updatedPassword = password;
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        empId,
        jobRole,
        password: updatedPassword,
      },
    });

    res.json({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server error" });
  }
};


export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    await prisma.user.delete({ where: { id } });

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isActive: !user.isActive,
      },
    });

    res.json(updatedUser);
  } catch (err) {
    console.error("Toggle status error:", err);
    res.status(500).json({ error: err.message });
  }
};