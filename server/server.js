// server/server.js — API PROCESS ONLY
//
// This process serves HTTP requests and never sends email. Campaign
// sending, the scheduler, IMAP sync and cleanup jobs run in worker.js:
//
//   npm start              → this file   (Render: Web Service)
//   npm run start:worker   → worker.js   (Render: Background Worker, ONE instance)

import "dotenv/config";

// Must be set before prismaClient.js is imported (it sizes the pool by role).
process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "api";

const { default: express } = await import("express");
const { default: cors } = await import("cors");
const { default: helmet } = await import("helmet");
const { default: prisma } = await import("./src/prismaClient.js");
const { initObservability, captureError, flushObservability } =
  await import("./src/observability.js");
await initObservability("api");

const { default: accountRoutes } =
  await import("./src/routes/inbox/accounts.js");
const { default: inboxRoutes } = await import("./src/routes/inbox/inbox.js");
const { default: customStatusRoutes } =
  await import("./src/routes/inbox/customStatusRoutes.js");
const { default: userRoutes } = await import("./src/routes/user.js");
const { default: smtpMailerRoutes } =
  await import("./src/routes/inbox/smtpMailerRoutes.js");
const { default: campaignsRoutes } =
  await import("./src/routes/campaigns.routes.js");
const { default: pitchRoutes } = await import("./src/routes/pitch.routes.js");
const { default: leadsRoutes } = await import("./src/routes/leads.routes.js");
const { default: analyticsRoutes } =
  await import("./src/routes/analytics.routes.js");
const { default: dashboardRoutes } =
  await import("./src/routes/dashboard.routes.js");
const { default: accountGroupsRoutes } =
  await import("./src/routes/inbox/accountGroups.js");
const { default: deliverabilityRoutes } =
  await import("./src/routes/deliverability.routes.js");
const { default: unsubscribeRoutes } =
  await import("./src/routes/unsubscribe.routes.js");
const { default: crmRoutes } = await import("./src/routes/crm.routes.js");
const { default: automationRoutes } =
  await import("./src/routes/automation.routes.js");

if (!process.env.JWT_SECRET) {
  console.error("💥 JWT_SECRET is not set — refusing to start.");
  process.exit(1);
}

const app = express();

app.disable("x-powered-by");
// Behind Render's proxy: correct req.ip / req.protocol (rate limits use req.ip).
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);

// Standard security headers. The API serves JSON plus the small
// unsubscribe page (inline styles, no scripts), so the default CSP fits.
// Cross-origin resource policy is relaxed because the frontend lives on a
// different origin and loads files (attachments) from this API.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// --------------------
// Middlewares
// --------------------
// Large limit is needed for campaign creation (recipient lists + HTML) and
// attachments sent through the SMTP routes.
const BODY_LIMIT = process.env.BODY_LIMIT || "50mb";
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://v3m45cfg-5173.inc1.devtunnels.ms",
  "https://abaccomarketing.onrender.com",
];
const allowedOrigins = (
  process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",")
    : DEFAULT_ORIGINS
)
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
    maxAge: 600, // cache preflight responses for 10 minutes
  }),
);

// Slow-request log: surfaces the endpoints worth optimising next.
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 2000;
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_MS) {
      console.warn(
        `🐢 ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`,
      );
    }
  });
  next();
});

// --------------------
// Health checks
// --------------------
// Liveness: the process is up. Does not touch the database, so a database
// blip doesn't make the platform restart a healthy API.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", role: "api", uptime: Math.round(process.uptime()) });
});

// Readiness: the database answers.
app.get("/api/health/db", async (_req, res) => {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "up", latencyMs: Date.now() - t0 });
  } catch (err) {
    res
      .status(503)
      .json({
        status: "degraded",
        db: "down",
        error: err.message.split("\n").pop(),
      });
  }
});

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
app.use("/api/deliverability", deliverabilityRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/automation", automationRoutes);

// Public unsubscribe links (no login): https://<api>/u/<token>
app.use("/u", unsubscribeRoutes);

// --------------------
// 404 + error handler
// --------------------
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: "Not found" });
});

app.use((err, req, res, _next) => {
  if (err?.type === "entity.too.large") {
    return res
      .status(413)
      .json({ success: false, message: "Request body too large" });
  }
  if (err?.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid JSON body" });
  }
  console.error("Unhandled error:", req.method, req.originalUrl, err);
  captureError(err, {
    tags: { route: req.originalUrl?.slice(0, 200), method: req.method },
    user: req.user,
  });
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Server error" });
});

// --------------------
// Start
// --------------------
const PORT = Number(process.env.PORT) || 5000;

const server = app.listen(PORT, () => {
  console.log(`✅ API server running on port ${PORT}`);
  console.log(
    "ℹ️  Background jobs run separately — start them with: npm run start:worker",
  );
});

// Keep-alive must outlive the load balancer's idle timeout, otherwise the
// proxy reuses sockets Node already closed and clients see random 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
// Long enough for the largest legitimate request (bulk campaign creation).
server.requestTimeout = 120_000;

// --------------------
// Graceful shutdown
// --------------------
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — closing API server...`);

  setTimeout(() => process.exit(exitCode), 10_000).unref();

  server.close(async () => {
    await flushObservability();
    try {
      await prisma.$disconnect();
    } catch {
      /* already closed */
    }
    process.exit(exitCode);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in API:", err);
  captureError(err, { tags: { kind: "unhandledRejection" } });
});

process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception in API:", err);
  captureError(err, { tags: { kind: "uncaughtException" } });
  shutdown("uncaughtException", 1);
});
