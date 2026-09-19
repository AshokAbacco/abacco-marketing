// tests/run-all.mjs — runs every suite in its own process.
//
//   npm test                 # all suites
//   npm test -- phase3       # only suites whose name contains "phase3"
//
// Each suite boots the API/worker code against an in-memory database mock
// (tests/fake-prisma.mjs) with fake SMTP and IMAP servers, so no database,
// mail server or network access is needed.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const suites = readdirSync(here)
  .filter((f) => f.endsWith("-test.mjs"))
  .filter((f) => !filter.length || filter.some((q) => f.includes(q)))
  .sort();

if (!suites.length) {
  console.error(`No test suites matched ${filter.join(", ")}`);
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: process.env.JWT_SECRET || "test-secret",
  NODE_ENV: "test",
  SENTRY_DSN: "",
};

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      ["--import", path.join(here, "register.mjs"), path.join(here, file)],
      { cwd: path.join(here, ".."), env, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ file, code, out, ms: Date.now() - started }));
  });

let failed = 0;
for (const file of suites) {
  const r = await run(file);
  const checks = (r.out.match(/^✔/gm) || []).length;
  if (r.code === 0) {
    console.log(`✅ ${file.padEnd(28)} ${String(checks).padStart(2)} checks  ${(r.ms / 1000).toFixed(1)}s`);
  } else {
    failed++;
    console.log(`❌ ${file}  (exit ${r.code})`);
    console.log(r.out.split("\n").filter((l) => /✔|Error|Assertion|expected|actual|at file/.test(l)).slice(-25).join("\n"));
  }
}

console.log(failed ? `\n${failed} suite(s) failed` : `\nAll ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
