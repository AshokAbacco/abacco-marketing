import express from "express";
import { getTodayCampaignReport } from "../controllers/analytics.controller.js";
import { protect } from "../middlewares/authMiddleware.js";


const router = express.Router();

// Today's Campaign Analytics
router.get("/today", protect, getTodayCampaignReport);

export default router;
