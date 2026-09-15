// src/prismaClient.js
//
// ONE PrismaClient (= one connection pool) per process. Every file must
// import this module — never call `new PrismaClient()` anywhere else, or
// that file silently opens its own extra pool against the database.
import { PrismaClient } from "@prisma/client";

/* ═══════════════════════════════════════════════════════════════════════════
   POOL SIZING

   Each Postgres connection costs the database server ~5–10 MB of RAM. The
   "database system is in recovery mode" crash is what a small Postgres
   instance does when it runs out of memory, so the total across ALL
   processes must stay well below the server's max_connections:

       SHOW max_connections;

       API process      PROCESS_ROLE=api     → default pool 8
       Worker process   PROCESS_ROLE=worker  → default pool 6
       ─────────────────────────────────────────────────────
       total                                   14 connections

   Override per process with PRISMA_POOL_SIZE. If the provider offers a
   pooled (PgBouncer) connection string, use it for DATABASE_URL and set
   PRISMA_PGBOUNCER=true; keep a direct URL in DIRECT_DATABASE_URL for
   `prisma db push`.

   Existing connection_limit / pool_timeout / connect_timeout keys in
   DATABASE_URL are OVERWRITTEN (not duplicated) so there is exactly one
   value for each.
═══════════════════════════════════════════════════════════════════════════ */

const ROLE = (process.env.PROCESS_ROLE || "api").toLowerCase();
const DEFAULT_POOL = ROLE === "worker" ? 6 : 8;

const POOL_SIZE = positiveInt(process.env.PRISMA_POOL_SIZE, DEFAULT_POOL);
const POOL_TIMEOUT = positiveInt(process.env.PRISMA_POOL_TIMEOUT, 15); // seconds
const CONNECT_TIMEOUT = positiveInt(process.env.PRISMA_CONNECT_TIMEOUT, 10);
// Optional server-side statement timeout (ms). Opt-in because some poolers
// reject startup options. When set, Postgres aborts any single statement
// that runs longer, so a runaway query can't hold a connection forever.
const STATEMENT_TIMEOUT_MS = positiveInt(
  process.env.PRISMA_STATEMENT_TIMEOUT_MS,
  0,
);

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function buildDbUrl() {
  const raw = process.env.DATABASE_URL || "";
  if (!raw) {
    console.warn("⚠️  DATABASE_URL is not set — Prisma will fail to connect.");
    return raw;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    console.warn(
      "⚠️  Could not parse DATABASE_URL as a URL — using it unchanged.",
    );
    return raw;
  }

  url.searchParams.set("connection_limit", String(POOL_SIZE));
  url.searchParams.set("pool_timeout", String(POOL_TIMEOUT));
  url.searchParams.set("connect_timeout", String(CONNECT_TIMEOUT));
  // Shows up in pg_stat_activity, so you can see which process holds
  // which connections when diagnosing load.
  if (!url.searchParams.has("application_name")) {
    url.searchParams.set("application_name", `abacco-${ROLE}`);
  }

  const usePgBouncer =
    String(process.env.PRISMA_PGBOUNCER).toLowerCase() === "true";
  if (usePgBouncer) {
    url.searchParams.set("pgbouncer", "true");
  } else if (STATEMENT_TIMEOUT_MS > 0 && !url.searchParams.has("options")) {
    // PgBouncer (transaction mode) rejects startup options, hence the else.
    url.searchParams.set(
      "options",
      `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
    );
  }

  return url.toString();
}

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__abaccoPrisma ||
  new PrismaClient({
    log:
      process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
    datasources: { db: { url: buildDbUrl() } },
  });

// Reuse across nodemon hot reloads in development.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__abaccoPrisma = prisma;
}

console.log(
  `🔌 Prisma pool: role=${ROLE} limit=${POOL_SIZE} poolTimeout=${POOL_TIMEOUT}s ` +
    `statementTimeout=${STATEMENT_TIMEOUT_MS || "off"}`,
);

/* ── Shared DB-error classifier (used by auth middleware + worker) ───────── */
const DB_DOWN_CODES = new Set([
  "P1001", // can't reach database
  "P1002", // database timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024", // timed out fetching a connection from the pool
]);

export function isDbUnavailableError(err) {
  if (!err) return false;
  if (DB_DOWN_CODES.has(err.code)) return true;
  const msg = String(err.message || "");
  return (
    msg.includes("Timed out fetching a new connection") ||
    msg.includes("Server has closed the connection") ||
    msg.includes("recovery mode") ||
    msg.includes("not yet accepting connections") ||
    msg.includes("Can't reach database server") ||
    msg.includes("Connection terminated") ||
    msg.includes("canceling statement due to statement timeout")
  );
}

export default prisma;
