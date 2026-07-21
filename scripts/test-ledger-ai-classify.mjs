/**
 * Ledger AI + business profile wiring smoke.
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
const profileLib = readFileSync(join(root, "src/lib/business-profile.ts"), "utf8");
const setup = readFileSync(join(root, "src/components/BusinessProfileSetup.tsx"), "utf8");
const settingsPage = readFileSync(join(root, "src/app/settings/page.tsx"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.equal(guessFromLabels("ค่าขนส่งแก้ว"), "cogs");
assert.match(classify.SYSTEM_PROMPT, /ค่าไฟ/);
assert.match(classify.DEFAULT_BUSINESS_CONTEXT, /ชานมไข่มุก/);
assert.match(classify.DEFAULT_BUSINESS_CONTEXT, /40%/);
assert.match(classify.buildSystemPrompt(""), /บริบทกิจการ/);
assert.match(classify.buildSystemPrompt("ประเภทกิจการ: ทดสอบ"), /ทดสอบ/);

assert.match(profileLib, /meta.*businessProfile|businessProfile/);
assert.match(profileLib, /formatBusinessProfileForAi/);
assert.match(profileLib, /DEFAULT_BUSINESS_PROFILE/);
assert.match(setup, /โปรไฟล์กิจการ/);
assert.match(settingsPage, /BusinessProfileSetup/);
assert.match(version, /APP_BUILD = 194/);

function guessFromLabels(description) {
  const fnMatch = labels.match(
    /export function guessTypeFromDescription\(description: string\): string \{([\s\S]*?)\n\}/,
  );
  assert.ok(fnMatch);
  return vm.runInNewContext(
    `function guessTypeFromDescription(description) {${fnMatch[1]}}\nguessTypeFromDescription`,
  )(description);
}

console.log("OK test-ledger-ai-classify");
