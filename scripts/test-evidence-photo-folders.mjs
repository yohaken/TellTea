/**
 * Guard: evidencePhotos rules allow every app storageFolder (incl. bonus/payroll).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rules = read("firestore.rules");
const evidence = read("src/lib/evidence-photos.ts");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*554/);
assert.match(rules, /function evidencePhotoStaffFolder/);
for (const folder of [
  "bonus-deductions",
  "payroll",
  "cash-deposits",
  "vat-input",
  "ot-photos",
  "ledger-receipts",
]) {
  assert.match(rules, new RegExp(`'${folder}'`));
  assert.match(evidence, new RegExp(`"${folder}"`));
}
assert.match(evidence, /isAllowedEvidencePhotoFolder/);
assert.match(evidence, /โฟลเดอร์รูปไม่ถูกต้อง/);

// Every storageFolder= in components must be allowlisted
const appSrc = [
  read("src/components/BonusDeductionEvidencePanel.tsx"),
  read("src/components/PayrollPayPanel.tsx"),
  read("src/components/CashInLedgerPanel.tsx"),
  read("src/components/vat-sales/VatSalesInputVatPanel.tsx"),
  read("src/app/ot/page.tsx"),
  read("src/app/owner-books/page.tsx"),
].join("\n");

const folders = [
  ...appSrc.matchAll(/storageFolder=["']([^"']+)["']/g),
  ...appSrc.matchAll(/folder:\s*["']([^"']+)["']/g),
].map((m) => m[1]);

for (const folder of new Set(folders)) {
  if (folder === "owner-books") {
    assert.match(rules, /owner-books/);
    continue;
  }
  assert.match(
    rules,
    new RegExp(`'${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`),
    `firestore.rules missing evidence folder: ${folder}`,
  );
}

console.log("OK test-evidence-photo-folders");
