// src/controllers/userController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";


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

    // ❌ Remove bcrypt hashing
    // const hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            email,

            // ✅ Store plain password
            password: password,

            empId,
            name,
            jobRole,
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

    // ✅ Block inactive users
    if (!user.isActive) {
      return res.status(403).json({
        error: "Your account is inactive. Please contact admin.",
      });
    }

    // ✅ Password check (plain or bcrypt)
    const isMatch = password === user.password;
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // ✅ Generate JWT token
    const token = generateToken(user.id);

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

    // ✅ Store plain password (no hashing)
    if (password && password.trim() !== "") {
      updatedPassword = password; // Remove bcrypt.hash()
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

    // Check if user exists
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

    // ✅ Check if user exists
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ Toggle the status
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isActive: !user.isActive,
      },
    });

    // ✅ Return the updated user with the new status
    res.json(updatedUser);
  } catch (err) {
    console.error("Toggle status error:", err);
    res.status(500).json({ error: err.message });
  }
};