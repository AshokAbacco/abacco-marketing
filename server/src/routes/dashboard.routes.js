// routes/dashboard.routes.js

import express from "express";
import { getDashboard } from "../controllers/dashboard.controller.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// `protect` was missing — this endpoint was fully unauthenticated, and the
// controller now needs req.user.id to scope results to the logged-in user.
router.get("/", protect, getDashboard);

export default router;