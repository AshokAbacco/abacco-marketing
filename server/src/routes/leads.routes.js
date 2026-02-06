// server/src/routes/leads.routes.js
import express from "express";
import {
  createLeadFromInbox,
  getAllLeads,
  getLeadById,
  deleteLead,
  updateLead,
} from "../controllers/leads.controller.js";

import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ✅ Protected Routes
router.post("/create-from-inbox", protect, createLeadFromInbox);
router.get("/", protect, getAllLeads);
router.get("/:id", protect, getLeadById);
router.delete("/:id", protect, deleteLead);
router.put("/:id", protect, updateLead);

export default router;
