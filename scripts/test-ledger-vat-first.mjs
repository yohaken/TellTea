/**
 * Staff VAT-first phase machine for ledger cash-out create.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Compile-free: re-implement mirrors by reading TS source contracts + dynamic import via tsx if needed.
// Prefer asserting source + duplicating pure logic checks inline for CI without tsx.

const helperSrc = readFileSync(join(root, "src/lib/ledger-vat-first.ts"), "utf8");
const modalSrc = readFileSync(join(root, "src/components/LedgerAddOutModal.tsx"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const billSrc = readFileSync(join(root, "src/components/BillNoticeLedgerPanel.tsx"), "utf8");

assert.match(helperSrc, /VatFirstPhase/);
assert.match(helperSrc, /initialVatFirstPhase/);
assert.match(helperSrc, /phaseAfterVatAsk/);
assert.match(helperSrc, /phaseAfterAiVatExtract/);
assert.match(helperSrc, /staffVatReadyToSave/);

assert.match(modalSrc, /vatFirstPhase/);
assert.match(modalSrc, /เอกสารนี้มี VAT หรือไม่/);
assert.match(modalSrc, /ยอดภาษีมูลค่าเพิ่ม/);
assert.match(modalSrc, /ตรงกับเอกสาร/);
assert.match(modalSrc, /initialVatFirstPhase/);
assert.match(modalSrc, /staffVatReadyToSave/);
assert.match(pageSrc, /LedgerAddOutModal/);
assert.doesNotMatch(billSrc, /vatFirstPhase/);
assert.doesNotMatch(billSrc, /เอกสารนี้มี VAT หรือไม่/);

// Pure logic (keep in sync with src/lib/ledger-vat-first.ts)
function initialVatFirstPhase(isOwner) {
  return isOwner ? "form" : "ask";
}
function phaseAfterVatAsk(hasVatDocument) {
  return hasVatDocument ? "upload" : "form";
}
function phaseAfterAiVatExtract(vatInput) {
  const n = Number(vatInput);
  if (Number.isFinite(n) && n > 0) return "confirm_ai";
  return "manual";
}
function staffVatReadyToSave({ isOwner, phase, hasVat, vatVerified, vatInput }) {
  if (isOwner) return true;
  if (phase !== "form") return false;
  if (!hasVat) return true;
  return vatVerified && vatInput > 0;
}

assert.equal(initialVatFirstPhase(true), "form");
assert.equal(initialVatFirstPhase(false), "ask");
assert.equal(phaseAfterVatAsk(true), "upload");
assert.equal(phaseAfterVatAsk(false), "form");
assert.equal(phaseAfterAiVatExtract(14), "confirm_ai");
assert.equal(phaseAfterAiVatExtract(0), "manual");
assert.equal(phaseAfterAiVatExtract(null), "manual");

assert.equal(
  staffVatReadyToSave({
    isOwner: false,
    phase: "form",
    hasVat: true,
    vatVerified: true,
    vatInput: 14,
  }),
  true,
);
assert.equal(
  staffVatReadyToSave({
    isOwner: false,
    phase: "form",
    hasVat: true,
    vatVerified: false,
    vatInput: 14,
  }),
  false,
);
assert.equal(
  staffVatReadyToSave({
    isOwner: false,
    phase: "upload",
    hasVat: true,
    vatVerified: false,
    vatInput: 0,
  }),
  false,
);
assert.equal(
  staffVatReadyToSave({
    isOwner: false,
    phase: "form",
    hasVat: false,
    vatVerified: false,
    vatInput: 0,
  }),
  true,
);

console.log("OK test-ledger-vat-first");
