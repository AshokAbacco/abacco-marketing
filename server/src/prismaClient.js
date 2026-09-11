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

   NOTE: DATABASE_URL may already carry its own connection_limit /
   pool_timeout / connect_timeout (ours does, in .env). We used to just
   string-concat our own params onto the end, which produced a URL with
   each key listed TWICE and left it up to chance which value Prisma
   actually used. Now we parse the URL and OVERWRITE those three keys
   instead of appending, so there's exactly one value for each and it's
   always the one computed below.
═══════════════════════════════════════════════════════════════════════════ */

const globalForPrisma = globalThis;

const POOL_SIZE    = Number(process.env.PRISMA_POOL_SIZE) || 15;
const POOL_TIMEOUT = Number(process.env.PRISMA_POOL_TIMEOUT) || 20;

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
    // Fallback for a malformed/relative URL — shouldn't happen in practice,
    // but better to fall back to the old append behavior than crash on boot.
    console.warn("⚠️  Could not parse DATABASE_URL as a URL — falling back to raw string.");
    return raw;
  }

  // set() overwrites an existing key instead of adding a duplicate, unlike
  // the old `${base}&connection_limit=...` string concatenation.
  url.searchParams.set("connection_limit", String(POOL_SIZE));
  url.searchParams.set("pool_timeout", String(POOL_TIMEOUT));
  url.searchParams.set("connect_timeout", "10");

  return url.toString();
}

const dbUrl = buildDbUrl();

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