import express from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  getAllUsers,
  updateUser,
  deleteUser,
  toggleUserStatus,
} from "../controllers/userController.js";
import { protect, requireAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public
router.post("/login", loginUser);

// Any logged-in user
router.get("/me", protect, getCurrentUser);

// User management — Admin / HR only.
// These were previously open to every logged-in user, and /register was
// completely public (anyone could create an admin account). The admin
// "Add Employee" screen already sends the auth token, so it keeps working.
router.post("/register", protect, requireAdmin, registerUser);
router.get("/all", protect, requireAdmin, getAllUsers);
router.put("/:id/status", protect, requireAdmin, toggleUserStatus);
router.put("/:id", protect, requireAdmin, updateUser);
router.delete("/:id", protect, requireAdmin, deleteUser);

export default router;
