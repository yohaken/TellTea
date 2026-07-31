/**
 * Gate: audit script for leftover nPos sales vs keep session code.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "scripts/audit-npos-sales-keep-session.mjs")));
assert.ok(
  existsSync(join(root, ".github/workflows/audit-npos-sales-keep-session.yml")),
);

const script = read("scripts/audit-npos-sales-keep-session.mjs");
assert.match(script, /KEEP_SESSION_CODE/);
assert.match(script, /posSessionCode|slice\(-12\)/);
assert.match(script, /posSales/);
assert.match(script, /posSessions/);
assert.match(script, /posMenuRank/);
assert.match(script, /outsideKeepSales/);
assert.doesNotMatch(script, /batch\.delete|APPLY\s*=/);

const wf = read(".github/workflows/audit-npos-sales-keep-session.yml");
assert.match(wf, /workflow_dispatch/);
assert.match(wf, /audit-npos-sales-keep-session\.mjs/);
assert.match(wf, /FIREBASE_SERVICE_ACCOUNT/);

console.log("OK test-audit-npos-sales-keep-session");
