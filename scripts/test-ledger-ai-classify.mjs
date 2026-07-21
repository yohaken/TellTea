/**
 * Ledger AI + business profile + owner-books wiring smoke.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
const ledgerPage = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const ownerBooksPage = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const ownerBooksLib = readFileSync(join(root, "src/lib/owner-books.ts"), "utf8");
const typeField = readFileSync(join(root, "src/components/LedgerTypeField.tsx"), "utf8");
const progressModal = readFileSync(join(root, "src/components/AiSaveProgressModal.tsx"), "utf8");

assert.equal(guessFromLabels("ค่าขนส่งแก้ว"), "cogs");
assert.match(classify.SYSTEM_PROMPT, /ค่าไฟ/);
assert.match(classify.DEFAULT_BUSINESS_CONTEXT, /ชานมไข่มุก/);
assert.match(classify.DEFAULT_BUSINESS_CONTEXT, /40%/);
assert.match(classify.buildSystemPrompt(""), /บริบทกิจการ/);
assert.match(classify.buildSystemPrompt("ประเภทกิจการ: ทดสอบ"), /ทดสอบ/);

assert.match(profileLib, /meta.*businessProfile|businessProfile/);
assert.match(profileLib, /formatBusinessProfileForAi/);
assert.match(profileLib, /DEFAULT_BUSINESS_PROFILE/);
assert.match(profileLib, /logoUrl/);
assert.match(setup, /โปรไฟล์กิจการ/);
assert.match(setup, /BusinessLogoField/);
assert.match(settingsPage, /BusinessProfileSetup/);
assert.match(version, /APP_BUILD = 201/);

const logoField = readFileSync(join(root, "src/components/BusinessLogoField.tsx"), "utf8");
const receipts = readFileSync(join(root, "src/lib/receipts.ts"), "utf8");
const evidence = readFileSync(join(root, "src/lib/evidence-photos.ts"), "utf8");
const appBrand = readFileSync(join(root, "src/components/AppBrand.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");
const brandLogo = readFileSync(join(root, "src/lib/brand-logo.ts"), "utf8");

assert.match(logoField, /business-logo-stage/);
assert.match(logoField, /saveBrandLogo/);
assert.match(logoField, /fileToLogoDataUrl/);
assert.match(receipts, /fileToLogoDataUrl/);
assert.match(receipts, /image\/png/);
assert.match(evidence, /encode\?:\s*"receipt"\s*\|\s*"logo"/);
assert.match(appBrand, /brand-logo-dark-pad/);
assert.match(appBrand, /BRAND_LOGO_CHANGED_EVENT/);
assert.match(appBrand, /loadBrandLogo/);
assert.match(appBrand, /useCustom \?/);
assert.match(appBrand, /\/logo-telltea\.svg/);
assert.match(css, /\.business-logo-stage/);
assert.match(css, /\.brand-logo-dark-pad/);
assert.match(css, /\.hero-brand \.brand-logo-dark-pad/);
assert.match(rules, /docId == 'businessProfile'/);
assert.match(rules, /docId == 'brandLogo'/);
assert.match(brandLogo, /meta", "brandLogo"/);
assert.doesNotMatch(profileLib, /saveBusinessLogo|cacheBrandLogo|localStorage/);

// Staff ledger: no opt-in photo AI checkbox
assert.doesNotMatch(ledgerPage, /AiUseImagesCheckbox|useImagesForAi|ใช้รูปช่วยจัดประเภท/);
assert.match(ledgerPage, /classifyLedgerTypeWithAi\(description\)/);
assert.match(ledgerPage, /AiSaveProgressModal/);
assert.match(typeField, /โปรไฟล์กิจการ/);
assert.doesNotMatch(progressModal, /withImages|รวมรูปหลักฐานที่ติ๊กไว้/);
assert.equal(existsSync(join(root, "src/components/AiUseImagesCheckbox.tsx")), false);
assert.equal(existsSync(join(root, "src/hooks/use-ledger-ai-classify.ts")), false);

// Owner books: same CF + save-time AI (text only)
assert.match(ownerBooksPage, /classifyLedgerTypeWithAi/);
assert.match(ownerBooksPage, /AiSaveProgressModal/);
assert.match(ownerBooksPage, /LedgerTypeField/);
assert.match(ownerBooksLib, /typeSource/);
assert.match(ownerBooksLib, /typeAiReason/);

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
