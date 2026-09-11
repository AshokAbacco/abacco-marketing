// server/server.js — API PROCESS ONLY
//
// Background work (campaign sending, IMAP sync, recovery sweeps, the
// scheduler) has moved to worker.js and runs as a SEPARATE process.
//
// Why: both used to share this process and its 10-connection Prisma pool.
// Send workers run at concurrency 2 per account across every active
// campaign, so with 10–20 users sending they held nearly every connection
// and API requests queued until pool_timeout (30s) fired. That is what made
// the campaign pages slow to open and sometimes hang on a spinner.
//
// Run both:
//   npm start          → this file  (Render: Web Service)
//   npm run start:worker → worker.js (Render: Background Worker)
//
// ⚠ Run exactly ONE worker instance. The campaign lock in
//   campaignMailer.service.js (activeCampaigns) is an in-memory Set, so two
//   workers would both pick up the same campaign and double-send. See
//   PERFORMANCE_FIXES.md §1c for the Postgres advisory-lock swap that
//   removes this restriction.

import "dotenv/config";   // previously loaded only incidentally via imap.service.js
import express from "express";
import cors from "cors";

// Routes
import accountRoutes from "./src/routes/inbox/accounts.js";
import inboxRoutes from "./src/routes/inbox/inbox.js";
import customStatusRoutes from "./src/routes/inbox/customStatusRoutes.js";
import userRoutes from "./src/routes/user.js";
import smtpMailerRoutes from "./src/routes/inbox/smtpMailerRoutes.js";
import campaignsRoutes from "./src/routes/campaigns.routes.js";
import pitchRoutes from "./src/routes/pitch.routes.js";
import leadsRoutes from "./src/routes/leads.routes.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import dashboardRoutes from "./src/routes/dashboard.routes.js";
import accountGroupsRoutes from "./src/routes/inbox/accountGroups.js";

const app = express();

// --------------------
// Middlewares
// --------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://v3m45cfg-5173.inc1.devtunnels.ms/",
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
app.use("/api/account-groups", accountGroupsRoutes);
app.use("/api/dashboard", dashboardRoutes);

// --------------------
// Health check
// --------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", role: "api" });
});

// --------------------
// Error handler
// --------------------
// The app had none, so a thrown error in any handler left the request
// hanging until the browser timed out — which looked identical to the
// slowness we were chasing.
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", req.method, req.originalUrl, err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Server error" });
});

// --------------------
// Start
// --------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ API server running on port ${PORT}`);
  console.log("ℹ️  Background jobs run separately — start them with: npm run start:worker");
});