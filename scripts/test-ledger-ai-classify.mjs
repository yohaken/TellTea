/**
 * Ledger AI classify — heuristic + CF helpers + UI wiring smoke.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));

const classify = require("./classify-ledger.js");
const labels = readFileSync(join(root, "src/lib/ledger-labels.ts"), "utf8");
const ledgerPage = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const typeField = readFileSync(join(root, "src/components/LedgerTypeField.tsx"), "utf8");
const photoCell = readFileSync(join(root, "src/components/EntryPhotoCell.tsx"), "utf8");
const progress = readFileSync(join(root, "src/components/AiSaveProgressModal.tsx"), "utf8");
const useImages = readFileSync(join(root, "src/components/AiUseImagesCheckbox.tsx"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.equal(classify.normalizeType("cogs"), "cogs");
assert.match(labels, /เครื่องดื่ม/);

const fnMatch = labels.match(
  /export function guessTypeFromDescription\(description: string\): string \{([\s\S]*?)\n\}/,
);
assert.ok(fnMatch);
const guess = vm.runInNewContext(
  `function guessTypeFromDescription(description) {${fnMatch[1]}}\nguessTypeFromDescription`,
);
assert.equal(guess("ค่าเครื่องดื่ม"), "cogs");
assert.equal(guess("ค่าขนส่งแก้ว"), "cogs");
assert.equal(guess("ค่าส่งนม"), "cogs");
assert.equal(guess("ค่าขนส่ง"), "sga");
assert.equal(guess("ส่งเครื่องซ่อม"), "sga");

assert.match(classify.SYSTEM_PROMPT, /ค่าขนส่งแก้ว/);
assert.match(version, /APP_BUILD = 193/);

console.log("OK test-ledger-ai-classify");
