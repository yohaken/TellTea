/**
 * Guard: production runtime must not deep-link the dead telltea-shop host.
 * Auth-domain allowlists may still list the old hostname (harmless).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEAD = "telltea-shop.web.app";

const ALLOW_PREFIXES = [
  "docs/",
  "scripts/enable-phone-auth.mjs",
  "scripts/enable-pos-auth-domains.mjs",
  "scripts/test-restore-telltea-shop-hosting.mjs",
  "scripts/test-no-dead-telltea-shop-runtime.mjs",
  "scripts/test-npos-cut-bo-entry.mjs",
  "scripts/test-ledger-transfer-in-fab.mjs",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" ||
      name === ".git" ||
      name === ".next" ||
      name === "out" ||
      name === "out-pos" ||
      name === "coverage"
    ) {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|yml|yaml|md|html)$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(root)) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (ALLOW_PREFIXES.some((p) => rel === p || rel.startsWith(p))) continue;
  // Historical checklists / old notes — skip remaining docs-like paths already covered
  if (rel.startsWith("docs/") || rel.startsWith("npos-telltea/")) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes(DEAD)) hits.push(rel);
}

assert.deepEqual(
  hits,
  [],
  `Dead host ${DEAD} still referenced in runtime/docs-adjacent files:\n${hits.join("\n")}`,
);

// Explicit hotspots must point at telltea-bo
const push = readFileSync(join(root, "src/lib/push.ts"), "utf8");
assert.match(push, /telltea-bo\.web\.app\/ledger\/\?transferIn=1/);
const idx = readFileSync(join(root, "functions/index.js"), "utf8");
assert.match(idx, /telltea-bo\.web\.app\/ledger\/\?transferIn=1/);
const vat = readFileSync(join(root, "functions/vat-mail.js"), "utf8");
assert.match(vat, /telltea-bo\.web\.app\/vat-sales\//);
assert.doesNotMatch(vat, /telltea-shop\.web\.app/);

console.log("OK test-no-dead-telltea-shop-runtime");
