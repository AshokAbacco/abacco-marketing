// Extracts every prisma.$queryRaw`...` / $executeRaw`...` template from the
// server source and turns ${expr} into $1..$n.
import fs from "node:fs";
import path from "node:path";
export function extractSql(root) {
  const out = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== "node_modules") walk(p); continue; }
      if (!p.endsWith(".js")) continue;
      if (p.includes("/explam.js")) continue; // unmounted legacy file
      const src = fs.readFileSync(p, "utf8");
      const re = /\$(queryRaw|executeRaw)`/g;
      let m;
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length, depth = 0, sql = "", exprs = [], cur = "";
        for (; i < src.length; i++) {
          const ch = src[i];
          if (depth === 0 && ch === "`") break;
          if (depth === 0 && ch === "$" && src[i + 1] === "{") { depth = 1; i++; cur = ""; continue; }
          if (depth > 0) {
            if (ch === "{") depth++;
            if (ch === "}") { depth--; if (depth === 0) { exprs.push(cur); sql += `$${exprs.length}`; continue; } }
            cur += ch; continue;
          }
          sql += ch;
        }
        const line = src.slice(0, m.index).split("\n").length;
        out.push({ file: path.relative(root, p), line, kind: m[1], sql: sql.replace(/\\\\/g, "\\"), exprs });
      }
    }
  };
  walk(root);
  return out;
}
