// src/routes/automation.routes.js  →  /api/automation
import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  listSequences, listCandidateCampaigns, getSequence, createSequence, updateSequence,
  activateSequence, pauseSequence, archiveSequence, listEnrollments, stopEnrollment,
} from "../controllers/crm/automation.controller.js";

const router = express.Router();
router.use(protect);

router.get("/sequences", listSequences);
router.get("/sequences/candidates", listCandidateCampaigns);
router.post("/sequences", createSequence);
router.get("/sequences/:id", getSequence);
router.put("/sequences/:id", updateSequence);
router.post("/sequences/:id/activate", activateSequence);
router.post("/sequences/:id/pause", pauseSequence);
router.post("/sequences/:id/archive", archiveSequence);
router.get("/sequences/:id/enrollments", listEnrollments);
router.post("/enrollments/:id/stop", stopEnrollment);

export default router;
