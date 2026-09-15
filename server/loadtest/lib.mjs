// loadtest/lib.mjs — shared helpers for the load-test scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_FILE = path.join(HERE, ".state.json");

/** Refuse to run against anything that isn't clearly a local database. */
export function assertSafeDatabase() {
  const raw = process.env.DATABASE_URL || "";
  let host = "";
  try { host = new URL(raw).hostname; } catch { /* invalid */ }
  const local = ["localhost", "127.0.0.1", "::1", "postgres", "host.docker.internal"].includes(host);
  if (!local && process.env.LT_ALLOW_REMOTE_DB !== "yes-i-am-sure") {
    console.error(
      `\n⛔ DATABASE_URL points at "${host || "?"}", which is not a local database.\n` +
      `   The load test writes thousands of rows and must never run against production.\n` +
      `   Run it with:  node --env-file=loadtest/.env.loadtest <script>\n` +
      `   (Staging only: set LT_ALLOW_REMOTE_DB=yes-i-am-sure)\n`
    );
    process.exit(1);
  }
}

export function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const v = hit.split("=").slice(1).join("=");
  return typeof fallback === "number" ? Number(v) : v;
}

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error("⛔ No loadtest/.state.json — run the seed script first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Import the app's shared Prisma client with a small pool for tooling. */
export async function getPrisma(poolSize = 3) {
  process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "loadtest";
  process.env.PRISMA_POOL_SIZE = process.env.PRISMA_POOL_SIZE_TOOLS || String(poolSize);
  const mod = await import("../src/prismaClient.js");
  return mod.default;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function fmt(n, digits = 0) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function pct(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
