// server/server.js
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

// Routes
import accountRoutes from "./src/routes/inbox/accounts.js";
import inboxRoutes from "./src/routes/inbox/inbox.js";
import customStatusRoutes from "./src/routes/inbox/customStatusRoutes.js";
import userRoutes from "./src/routes/user.js";
import smtpMailerRoutes from "./src/routes/inbox/smtpMailerRoutes.js";
import campaignsRoutes from "./src/routes/campaigns.routes.js";
import pitchRoutes from "./src/routes/pitch.routes.js";
import leadsRoutes from "./src/routes/leads.routes.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";

const app = express();
const prisma = new PrismaClient();

// --------------------
// Middlewares
// --------------------
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://abaccomarketing.onrender.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

// --------------------
// Routes
// --------------------
app.use("/api/accounts", accountRoutes);
app.use("/api/inbox", inboxRoutes);
app.use("/api/customStatus", customStatusRoutes);
app.use("/api/smtp", smtpMailerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pitches", pitchRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/analytics", analyticsRoutes);
// --------------------
// Health check (IMPORTANT)
// --------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ API server running on port ${PORT}`);
  startCampaignScheduler(); // 🔥 Start scheduled campaigns on Render
});
