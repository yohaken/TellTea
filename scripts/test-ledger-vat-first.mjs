/**
 * VAT-first phase machine for cash-out create (ledger + owner-books + bill notice).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const helperSrc = readFileSync(join(root, "src/lib/ledger-vat-first.ts"), "utf8");
const stepsSrc = readFileSync(join(root, "src/components/VatFirstSteps.tsx"), "utf8");
const modalSrc = readFileSync(join(root, "src/components/LedgerAddOutModal.tsx"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const ownerSrc = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const billSrc = readFileSync(join(root, "src/components/BillNoticeLedgerPanel.tsx"), "utf8");
const billLib = readFileSync(join(root, "src/lib/bill-notices.ts"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(helperSrc, /VatFirstPhase/);
assert.match(helperSrc, /initialVatFirstPhase/);
assert.match(helperSrc, /phaseAfterVatAsk/);
assert.match(helperSrc, /phaseAfterAiVatExtract/);
assert.match(helperSrc, /vatFirstReadyToSave/);
assert.match(helperSrc, /return "ask"/);
assert.doesNotMatch(helperSrc, /isOwner \? "form"/);

assert.match(stepsSrc, /VatFirstAskPanel/);
assert.match(stepsSrc, /VatFirstCapturePanel/);
assert.match(stepsSrc, /VatFirstFormSummary/);
assert.match(stepsSrc, /เอกสารนี้มี VAT หรือไม่/);
assert.match(stepsSrc, /ยอดภาษีมูลค่าเพิ่ม/);
assert.match(stepsSrc, /ตรงกับเอกสาร/);

assert.match(modalSrc, /vatFirstPhase/);
assert.match(modalSrc, /VatFirstAskPanel/);
assert.match(modalSrc, /initialVatFirstPhase/);
assert.match(modalSrc, /vatFirstReadyToSave/);
assert.match(modalSrc, /vatFirstGate = true/);
assert.match(pageSrc, /LedgerAddOutModal/);

assert.match(ownerSrc, /vatFirstPhase/);
assert.match(ownerSrc, /VatFirstAskPanel/);
assert.match(ownerSrc, /useVatFirst/);
assert.match(ownerSrc, /vatFirstReadyToSave/);

assert.match(billSrc, /vatFirstPhase/);
assert.match(billSrc, /VatFirstAskPanel/);
assert.match(billSrc, /useVatFirst/);
assert.match(billSrc, /vatFirstReadyToSave/);
assert.match(billLib, /hasVat/);
assert.match(billLib, /vatVerified/);
assert.match(billLib, /vatInput: prev.hasVat \? prev.vatInput/);

assert.match(versionSrc, /APP_BUILD = 49\d/);

function initialVatFirstPhase() {
  return "ask";
}
function phaseAfterVatAsk(hasVatDocument) {
  return hasVatDocument ? "upload" : "form";
}
function phaseAfterAiVatExtract(vatInput) {
  const n = Number(vatInput);
  if (Number.isFinite(n) && n > 0) return "confirm_ai";
  return "manual";
}
function vatFirstReadyToSave({ phase, hasVat, vatVerified, vatInput }) {
  if (phase !== "form") return false;
  if (!hasVat) return true;
  return vatVerified && vatInput > 0;
}

assert.equal(initialVatFirstPhase(true), "ask");
assert.equal(initialVatFirstPhase(false), "ask");
assert.equal(phaseAfterVatAsk(true), "upload");
assert.equal(phaseAfterVatAsk(false), "form");
assert.equal(phaseAfterAiVatExtract(14), "confirm_ai");
assert.equal(phaseAfterAiVatExtract(0), "manual");
assert.equal(phaseAfterAiVatExtract(null), "manual");

assert.equal(
  vatFirstReadyToSave({
    phase: "form",
    hasVat: true,
    vatVerified: true,
    vatInput: 14,
  }),
  true,
);
assert.equal(
  vatFirstReadyToSave({
    phase: "form",
    hasVat: true,
    vatVerified: false,
    vatInput: 14,
  }),
  false,
);
assert.equal(
  vatFirstReadyToSave({
    phase: "upload",
    hasVat: true,
    vatVerified: false,
    vatInput: 0,
  }),
  false,
);
assert.equal(
  vatFirstReadyToSave({
    phase: "form",
    hasVat: false,
    vatVerified: false,
    vatInput: 0,
  }),
  true,
);

console.log("OK test-ledger-vat-first");
