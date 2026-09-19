import pg from "pg";
import { extractSql } from "./extract.mjs";
const stmts = extractSql("/home/claude/work/server/src").concat(
  extractSql("/home/claude/work/server/scripts"), extractSql("/home/claude/work/server/loadtest").filter(()=>false)
);
const c = new pg.Client("postgresql://loadtest:loadtest@localhost:5433/abacco_p1");
await c.connect();
let ok = 0, bad = 0, i = 0;
for (const s of stmts) {
  const name = `s${i++}`;
  try {
    await c.query(`PREPARE ${name} AS ${s.sql}`);
    await c.query(`DEALLOCATE ${name}`);
    ok++;
  } catch (e) {
    bad++;
    console.log(`❌ ${s.file}:${s.line} → ${e.message}\n${s.sql.trim().slice(0, 200)}\n`);
  }
}
console.log(`${ok} statements valid, ${bad} invalid (of ${stmts.length})`);
await c.end();
