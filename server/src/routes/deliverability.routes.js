// src/routes/deliverability.routes.js  →  /api/deliverability
import express from "express";
import { protect, requireAdmin } from "../middlewares/authMiddleware.js";
import {
  getSummary,
  listSuppressions,
  addSuppressions,
  removeSuppression,
  exportSuppressions,
  listReviews,
  resolveReview,
  listAccountHealth,
  resumeSendingAccount,
  pauseSendingAccount,
  updateAccountLimits,
  getSendingLimitSettings,
  saveSendingLimitSettings,
  getTrends,
  getDomainAuth,
} from "../controllers/deliverability.controller.js";

const router = express.Router();

router.use(protect);

// Any user: health of THEIR OWN accounts (admins see all), and
// pausing/resuming accounts they own.
router.get("/accounts", listAccountHealth);
router.post("/accounts/:id/resume", resumeSendingAccount);
router.post("/accounts/:id/pause", pauseSendingAccount);
router.put("/accounts/:id/limits", updateAccountLimits);
router.get("/trends", getTrends);
router.get("/domains", getDomainAuth);
router.get("/settings/sending-limits", getSendingLimitSettings);
router.put("/settings/sending-limits", requireAdmin, saveSendingLimitSettings);

// Admin / HR only
router.get("/summary", requireAdmin, getSummary);
router.get("/suppressions", requireAdmin, listSuppressions);
router.get("/suppressions/export", requireAdmin, exportSuppressions);
router.post("/suppressions", requireAdmin, addSuppressions);
router.delete("/suppressions/:id", requireAdmin, removeSuppression);
router.get("/reviews", requireAdmin, listReviews);
router.post("/reviews/:id", requireAdmin, resolveReview);

export default router;
