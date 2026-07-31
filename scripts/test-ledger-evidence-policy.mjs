/**
 * Cash-out evidence policy — serious ack (not VAT-style multi-step).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Load TS via dynamic import through tsx-less path: re-implement from source for unit checks
// and assert wiring in UI files.

const policySrc = readFileSync(
  join(root, "src/lib/ledger-evidence-policy.ts"),
  "utf8",
);
const stepsSrc = readFileSync(
  join(root, "src/components/VatFirstSteps.tsx"),
  "utf8",
);
const modalSrc = readFileSync(
  join(root, "src/components/LedgerAddOutModal.tsx"),
  "utf8",
);
const ownerSrc = readFileSync(
  join(root, "src/app/owner-books/page.tsx"),
  "utf8",
);
const billSrc = readFileSync(
  join(root, "src/components/BillNoticeLedgerPanel.tsx"),
  "utf8",
);
const merge = require(join(root, "functions/merge-receipt-extract.js"));
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const entryVatSrc = readFileSync(join(root, "src/lib/entry-vat.ts"), "utf8");

assert.match(policySrc, /EvidenceDocPolicy/);
assert.match(policySrc, /staff_transfer/);
assert.match(policySrc, /isStaffTransferDescription/);
assert.match(policySrc, /evidenceNoticeCopy/);
assert.match(policySrc, /evidenceReadyToSave/);
assert.match(policySrc, /สลิปโอน \+ แคปแชท|สลิปและแชท/);
assert.match(policySrc, /ใบกำกับ|ใบเสร็จ/);
assert.match(policySrc, /EVIDENCE_CHAT_FALLBACK|แคปแชท/);
assert.match(policySrc, /goods_only|isGoodsOnlySignal/);
assert.match(policySrc, /ไม่มีบิลจริงๆ/);
assert.match(policySrc, /always-on|never dismiss|ทุกครั้ง/i);
assert.match(modalSrc, /แคปแชท/);
assert.match(ownerSrc, /แคปแชท/);
assert.match(billSrc, /แคปแชท/);

assert.match(stepsSrc, /EvidenceDocNotice/);
assert.match(stepsSrc, /evidence-doc-notice/);
assert.match(stepsSrc, /copy\.ackLabel/);
assert.match(policySrc, /เข้าใจแล้ว/);

assert.match(modalSrc, /EvidenceDocNotice/);
assert.match(modalSrc, /evidenceDocAck/);
assert.match(modalSrc, /evidenceReadyToSave/);
assert.match(modalSrc, /evidenceDocPolicy/);

assert.match(ownerSrc, /EvidenceDocNotice/);
assert.match(ownerSrc, /evidenceDocAck/);
assert.match(ownerSrc, /mode === "add"/);

assert.match(billSrc, /EvidenceDocNotice/);
assert.match(billSrc, /evidenceDocAck/);

assert.match(entryVatSrc, /slipOnly/);
assert.match(entryVatSrc, /docKind/);

assert.match(versionSrc, /APP_BUILD = 55\d/);

// --- pure policy helpers (inline mirror of exported logic) ---
function isStaffTransferDescription(description) {
  const text = String(description || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!text) return false;
  const hints = [
    "ค่าแรง",
    "ค่าจ้าง",
    "เงินเดือน",
    "โบนัส",
    "ทดลองงาน",
    "ทดลองรายวัน",
    "รายวัน",
    "เบิกล่วงหน้า",
    "เบิกเงิน",
    "โอนให้พนักงาน",
    "โอนพนักงาน",
    "โอนเข้าบัญชีพนักงาน",
    "จ่ายพนักงาน",
    "ค่าแรงทดลอง",
  ];
  return hints.some((h) => text.includes(h.replace(/\s+/g, "").toLowerCase()));
}

function evidenceDocPolicy(description) {
  return isStaffTransferDescription(description) ? "staff_transfer" : "purchase";
}

function isSlipOnlySignal(opts) {
  if (opts.slipOnly === true) return true;
  if (String(opts.docKind || "").toLowerCase() === "bank_slip") return true;
  const reason = String(opts.vatReason || "");
  return /สลิป/.test(reason) && !/ใบกำกับ|ใบเสร็จ|tax\s*invoice/i.test(reason);
}

function isGoodsOnlySignal(opts) {
  if (opts.goodsOnly === true) return true;
  if (opts.hasVat === true) return false;
  const kind = String(opts.docKind || "").toLowerCase();
  if (kind === "tax_invoice" || kind === "bank_slip") return false;
  if (kind === "other") return true;
  return false;
}

function evidenceWeakKind(opts) {
  if (isSlipOnlySignal(opts)) return "slip_only";
  if (isGoodsOnlySignal(opts)) return "goods_only";
  return "none";
}

function evidenceNoticeCopy(opts) {
  const policy = evidenceDocPolicy(opts.description);
  const weak = policy === "purchase" ? evidenceWeakKind(opts) : "none";
  if (policy === "staff_transfer") {
    return { policy, escalate: false, weakKind: "none", titleIncludes: "พนักงาน" };
  }
  return {
    policy,
    escalate: weak !== "none",
    weakKind: weak,
    titleIncludes:
      weak === "slip_only" ? "สลิป" : weak === "goods_only" ? "สินค้า" : "เอกสาร",
  };
}

function evidenceReadyToSave({ required, acked }) {
  if (!required) return true;
  return acked === true;
}

assert.equal(evidenceDocPolicy("แม็คโคร"), "purchase");
assert.equal(evidenceDocPolicy("ค่าแรงทดลองรายวัน — สมชาย"), "staff_transfer");
assert.equal(evidenceDocPolicy("โอนเข้าบัญชีพนักงาน"), "staff_transfer");
assert.equal(evidenceDocPolicy("เบิกล่วงหน้า"), "staff_transfer");
assert.equal(isSlipOnlySignal({ vatReason: "สลิปโอนเงิน — ไม่ใช้เป็นแหล่ง VAT" }), true);
assert.equal(isSlipOnlySignal({ slipOnly: true }), true);
assert.equal(isSlipOnlySignal({ docKind: "bank_slip" }), true);
assert.equal(isSlipOnlySignal({ vatReason: "ภาษีมูลค่าเพิ่ม 7% ท้ายบิล" }), false);
assert.equal(
  evidenceNoticeCopy({ description: "ท็อปเวิลด์", slipOnly: true }).escalate,
  true,
);
assert.equal(
  evidenceNoticeCopy({ description: "ค่าแรง", slipOnly: true }).escalate,
  false,
);
assert.equal(
  evidenceNoticeCopy({ description: "ซื้อแก้ว", goodsOnly: true }).weakKind,
  "goods_only",
);
assert.equal(
  evidenceNoticeCopy({ description: "ซื้อแก้ว", docKind: "other" }).weakKind,
  "goods_only",
);
assert.equal(
  evidenceNoticeCopy({
    description: "ซื้อแก้ว",
    docKind: "other",
    hasVat: true,
  }).weakKind,
  "none",
);
assert.equal(evidenceReadyToSave({ required: true, acked: false }), false);
assert.equal(evidenceReadyToSave({ required: true, acked: true }), true);

// merge exposes slipOnly
const single = merge.mergeExtractResults([
  {
    docKind: "bank_slip",
    date: "2026-07-01",
    description: "โอน",
    amountOut: 100,
    type: "sga",
    note: "",
    reason: "สลิป",
    hasVat: false,
    vatInput: null,
    vatBase: null,
    vatInvoiceNo: "",
    vatSeenOnBill: false,
    vatReason: "สลิปโอนเงิน — ไม่ใช้เป็นแหล่ง VAT",
  },
]);
assert.equal(single.slipOnly, true);
assert.equal(single.docKind, "bank_slip");
assert.equal(single.goodsOnly, false);

const goods = merge.mergeExtractResults([
  {
    docKind: "other",
    date: "2026-07-01",
    description: "แก้ว",
    amountOut: null,
    type: "cogs",
    note: "",
    reason: "รูปสินค้า",
    hasVat: false,
    vatInput: null,
    vatBase: null,
    vatInvoiceNo: "",
    vatSeenOnBill: false,
    vatReason: "ไม่มีบรรทัดภาษี",
  },
]);
assert.equal(goods.goodsOnly, true);
assert.equal(goods.slipOnly, false);

const mixed = merge.mergeExtractResults([
  {
    docKind: "bank_slip",
    date: "2026-07-01",
    description: "โอน",
    amountOut: 107,
    type: "cogs",
    note: "",
    reason: "สลิป",
    hasVat: false,
    vatInput: null,
    vatBase: null,
    vatInvoiceNo: "",
    vatSeenOnBill: false,
    vatReason: "สลิป",
  },
  {
    docKind: "tax_invoice",
    date: "2026-07-01",
    description: "แม็คโคร",
    amountOut: 107,
    type: "cogs",
    note: "",
    reason: "บิล",
    hasVat: true,
    vatInput: 7,
    vatBase: 100,
    vatInvoiceNo: "IV1",
    vatSeenOnBill: true,
    vatReason: "ภาษีมูลค่าเพิ่ม 7%",
  },
]);
assert.equal(mixed.slipOnly, false);
assert.equal(mixed.hasVat, true);

console.log("OK test-ledger-evidence-policy");
