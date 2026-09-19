import express from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  getAllUsers,
  updateUser,
  deleteUser,
  toggleUserStatus,
  resetUserPassword,
  changeOwnPassword,
} from "../controllers/userController.js";
import { protect, requireAdmin } from "../middlewares/authMiddleware.js";
import { loginLimiter } from "../middlewares/rateLimit.js";

const router = express.Router();

// Public — brute-force protected
router.post("/login", loginLimiter(), loginUser);

// Any logged-in user
router.get("/me", protect, getCurrentUser);
router.put("/me/password", protect, loginLimiter(), changeOwnPassword);

// User management — Admin / HR only.
router.post("/register", protect, requireAdmin, registerUser);
router.get("/all", protect, requireAdmin, getAllUsers);
router.put("/:id/status", protect, requireAdmin, toggleUserStatus);
router.put("/:id/password", protect, requireAdmin, resetUserPassword);
router.put("/:id", protect, requireAdmin, updateUser);
router.delete("/:id", protect, requireAdmin, deleteUser);

export default router;
