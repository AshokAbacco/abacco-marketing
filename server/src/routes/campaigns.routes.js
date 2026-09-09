import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  createCampaign,
  sendCampaignNow,
  scheduleCampaign,
  getAllCampaigns,
  createFollowupCampaign,
  getDashboardCampaigns,
  getCampaignProgress,
  getLockedAccounts,
  deleteCampaign,
  getCampaignsForFollowup,
  getSingleCampaign,
  stopCampaign,
  updateFollowupRecipients,   
  sendFollowupCampaign,        
  getDailyLimitStatus,
  getAdminDailyOverview,
  getRecipientBody,
  getCampaignRecipientEmails,
} from "../controllers/campaigns.controller.js";

const router = express.Router();

// Dashboard route should come BEFORE the generic "/" route
// to avoid route conflicts
router.get('/dashboard', protect, getDashboardCampaigns);

// 🔥 FIX: Specific routes MUST come before parameterized routes
// Move /for-followup BEFORE /:id/progress to avoid route conflicts
router.get("/for-followup", protect, getCampaignsForFollowup);

// Get locked accounts
router.get("/accounts/locked", protect, getLockedAccounts);

// Create campaign
router.post("/", protect, createCampaign);

// Get all campaigns
router.get("/", protect, getAllCampaigns);

// Create followup campaign
router.post("/followup", protect, createFollowupCampaign);

// 🔥 IMPORTANT: Specific parameterized routes (:id/view, :id/progress) come before generic :id routes
router.get("/:id/view", protect, getSingleCampaign);
router.get("/:id/progress", protect, getCampaignProgress);

// Full address list (unpaginated, scalar columns only) — used to build
// follow-ups and the copy-to-clipboard lists.
router.get("/:id/recipients", protect, getCampaignRecipientEmails);

// One rendered email body, fetched on demand.
router.get("/:id/recipients/:recipientId/body", protect, getRecipientBody);

router.post("/:id/send", protect, sendCampaignNow);
router.post("/:id/schedule", protect, scheduleCampaign);
router.delete("/:id", protect, deleteCampaign);
router.post("/:id/stop", protect, stopCampaign);

// Update followup recipients
router.post("/followup/update-recipients", protect, updateFollowupRecipients);

// Send followup manually
router.post("/followup/:id/send", protect, sendFollowupCampaign);
router.get("/daily-limit", protect, getDailyLimitStatus);
router.get("/admin/daily-overview", protect, getAdminDailyOverview);

export default router;