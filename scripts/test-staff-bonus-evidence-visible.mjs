/**
 * Guard: staff see caution/cut evidence after month close (no shop report).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(version, /APP_BUILD\s*=\s*556/);
assert.match(page, /staffRulesReport/);
assert.match(page, /rulesReport/);
assert.match(page, /buildBonusDeductionLines/);
assert.match(page, /rulesReport \|\| !shopPayView/);
assert.match(page, /BonusDeductionEvidencePanel/);

console.log("OK test-staff-bonus-evidence-visible");
