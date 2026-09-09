// src/prismaClient.js
import { PrismaClient } from "@prisma/client";

/* ═══════════════════════════════════════════════════════════════════════════
   POOL SIZING

   The API and the worker are separate processes now, so they should not
   share one hardcoded limit of 10.

   Set per process:
     Web service     PRISMA_POOL_SIZE=15
     Worker service  PRISMA_POOL_SIZE=15

   Check the total against your database's max_connections:
       SHOW max_connections;
   Managed Postgres often allows only 20–100. Two processes at 15 is 30.
   If that is too high, lower both and lower ACCOUNT_CONCURRENCY to match,
   or put PgBouncer in front and add ?pgbouncer=true.

   pool_timeout is 20s (was 30). Failing sooner is better than holding a
   request for half a minute — the caller retries and the queue drains.
═══════════════════════════════════════════════════════════════════════════ */

const globalForPrisma = globalThis;

const POOL_SIZE    = Number(process.env.PRISMA_POOL_SIZE) || 15;
const POOL_TIMEOUT = Number(process.env.PRISMA_POOL_TIMEOUT) || 20;

const params = [
  `connection_limit=${POOL_SIZE}`,
  `pool_timeout=${POOL_TIMEOUT}`,
  "connect_timeout=10",
].join("&");

const base = process.env.DATABASE_URL || "";
const dbUrl = base.includes("?") ? `${base}&${params}` : `${base}?${params}`;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["error", "warn"],
    datasources: { db: { url: dbUrl } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

console.log(
  `🔌 Prisma pool: limit=${POOL_SIZE} timeout=${POOL_TIMEOUT}s ` +
  `(${process.env.PROCESS_ROLE || "unspecified"})`
);

export default prisma;