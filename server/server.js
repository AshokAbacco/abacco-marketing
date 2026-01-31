// server/server.js
import express from "express";
import cors from "cors";

// import emailRoutes from "./src/routes/email.routes.js";
// import mailRoutes from "./src/routes/mail.routes.js";
// import attachmentRoutes from "./src/routes/attachment.routes.js";
import accountRoutes from "./src/routes/inbox/accounts.js";
import inboxRoutes from "./src/routes/inbox/inbox.js";
import customStatusRoutes from './src/routes/inbox/customStatusRoutes.js'
import userRoutes from "./src/routes/user.js";
import { runSync } from "./src/services/imap.service.js";
import { PrismaClient } from "@prisma/client";
import smtpMailerRoutes from "./src/routes/inbox/smtpMailerRoutes.js";
import campaignsRoutes from "./src/routes/campaigns.routes.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import pitchRoutes from "./src/routes/pitch.routes.js"
import leadsRoutes from "./src/routes/leads.routes.js"


const app = express();
app.use(express.json());
const prisma = new PrismaClient();

// --------------------
// Middlewares (must be first)
// --------------------
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://abaccomarketing.onrender.com"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);


app.use(express.json());


// setInterval(() => {
//   runSync(prisma).catch(console.error);
// }, 60 * 1000); // every 1 minute


// --------------------
// Routes
// --------------------
// app.use("/api/email", emailRoutes);
// app.use("/api/mail", mailRoutes);
// app.use("/api/attachments", attachmentRoutes);
startCampaignScheduler();

app.use("/api/accounts", accountRoutes);
app.use("/api/inbox", inboxRoutes);   
app.use("/api/customStatus", customStatusRoutes);
app.use("/api/smtp", smtpMailerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pitches", pitchRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
// --------------------
// Health check
// --------------------
app.get("/", (req, res) => {
  res.send("API is running...");
});

// --------------------
// Start server
// --------------------
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
