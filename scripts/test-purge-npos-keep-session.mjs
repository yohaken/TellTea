/**
 * Gate: purge orphans outside keep session — safety constraints.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "scripts/purge-npos-keep-session.mjs")));
assert.ok(existsSync(join(root, ".github/workflows/purge-npos-keep-session.yml")));

const script = read("scripts/purge-npos-keep-session.mjs");
assert.match(script, /KEEP_SESSION_CODE/);
assert.match(script, /keepSaleIds/);
assert.match(script, /saleId/);
assert.match(script, /recomputeRank|posMenuRank/);
assert.match(script, /touchesDevices:\s*false/);
assert.match(script, /ไม่พบรอบรหัส/);
assert.match(script, /APPLY/);

const wf = read(".github/workflows/purge-npos-keep-session.yml");
assert.match(wf, /Dry-run plan/);
assert.match(wf, /APPLY: "0"/);
assert.match(wf, /APPLY: "1"/);
assert.match(wf, /audit-npos-sales-keep-session\.mjs/);

console.log("OK test-purge-npos-keep-session");
