/**
 * Payroll payment proof document builders (source + mirror logic).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docSrc = readFileSync(
  join(root, "src/lib/payroll-payment-doc.ts"),
  "utf8",
);
const payUi = readFileSync(
  join(root, "src/components/PayrollPayPanel.tsx"),
  "utf8",
);
const histUi = readFileSync(
  join(root, "src/components/PayrollHistoryPanel.tsx"),
  "utf8",
);
const cardUi = readFileSync(
  join(root, "src/components/StaffLatestTransferCard.tsx"),
  "utf8",
);
const modalUi = readFileSync(
  join(root, "src/components/PayrollPaymentDocModal.tsx"),
  "utf8",
);
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(docSrc, /buildPayrollPaymentDocHtml/);
assert.match(docSrc, /buildReceiptFromJustPaid/);
assert.match(docSrc, /printPayrollPaymentDoc/);
assert.match(docSrc, /downloadPayrollPaymentDoc/);
assert.match(docSrc, /shopFromPosSettings/);
assert.match(docSrc, /ใบสรุปหลักฐานการจ่าย/);
assert.match(docSrc, /ไม่ใช่ใบหักภาษี ณ ที่จ่าย/);
assert.match(payUi, /buildReceiptFromJustPaid/);
assert.match(payUi, /PayrollPaymentDocModal/);
assert.match(payUi, /เปิดใบสรุปหลักฐานแล้ว/);
assert.match(histUi, /ใบสรุปหลักฐานจ่าย/);
assert.match(histUi, /buildStaffTransferReceipts/);
assert.match(cardUi, /ดูใบสรุปจ่าย/);
assert.match(modalUi, /พิมพ์ \/ บันทึก PDF/);
assert.match(modalUi, /ดาวน์โหลดไฟล์/);
assert.match(versionSrc, /APP_BUILD = 703/);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function money(n) {
  return String(round2(n));
}

function escapeReceiptHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortTransferKindLabel(kind) {
  if (kind === "salary_mid") return "กลางเดือน";
  if (kind === "salary_month_end") return "สิ้นเดือน";
  if (kind === "salary_special") return "จ่ายแยก";
  if (kind === "bonus") return "โบนัส";
  return kind;
}

function buildReceiptFromJustPaid(input) {
  const paidAt = input.paidAt || Date.now();
  const slipUrls = [...(input.slipUrls || [])].filter(Boolean);
  const note = (input.note || "").trim();
  const cid = (input.combinedPayId || "").trim();
  const lines = [...input.items]
    .sort((a, b) => a.dueDate - b.dueDate || a.kind.localeCompare(b.kind))
    .map((item) => ({
      kind: item.kind,
      amount: round2(item.amount),
      advanceDeduct: round2(item.advanceDeduct || 0),
      grossAmount: round2(item.grossAmount || item.amount),
      bonusRemaining: round2(item.bonusRemaining || 0),
      note: (item.note || "").trim(),
      item: { ...item, status: "paid", paidAt, combinedPayId: cid || item.combinedPayId },
    }));
  return {
    key: cid || lines[0]?.item.id || `pay_${paidAt}`,
    combined: Boolean(cid) && lines.length > 1,
    periodMonth: lines[0]?.item.periodMonth || "",
    paidAt,
    transferTotal: round2(lines.reduce((s, l) => s + l.amount, 0)),
    advanceDeductTotal: round2(lines.reduce((s, l) => s + l.advanceDeduct, 0)),
    slipUrls,
    note,
    lines,
  };
}

function buildPayrollPaymentDocHtml({ receipt, shop, payee }) {
  const lineRows = receipt.lines
    .map(
      (line) =>
        `<tr><td>${escapeReceiptHtml(shortTransferKindLabel(line.kind))}</td><td>฿${money(line.amount)}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html><body>
    <h1>${escapeReceiptHtml(shop.shopName)}</h1>
    <p>${escapeReceiptHtml(shop.shopNameTh || "")}</p>
    ${shop.taxId ? `<div>เลขผู้เสียภาษี ${escapeReceiptHtml(shop.taxId)}</div>` : ""}
    <h2>ใบสรุปหลักฐานการจ่าย</h2>
    <div>${escapeReceiptHtml(payee.employeeName)}</div>
    <div>${escapeReceiptHtml(receipt.periodMonth)}</div>
    <table>${lineRows}</table>
    <div>รวมยอดโอน ฿${money(receipt.transferTotal)}</div>
    <div>ไม่ใช่ใบหักภาษี ณ ที่จ่าย</div>
  </body></html>`;
}

const salary = {
  id: "s1",
  employeeId: "e1",
  employeeName: "สมชาย",
  periodMonth: "2026-07",
  kind: "salary_month_end",
  dueDate: 1,
  amount: 5000,
  advanceDeduct: 500,
  grossAmount: 5500,
  bonusRemaining: 0,
  note: "",
  combinedPayId: "",
};
const bonus = {
  id: "b1",
  employeeId: "e1",
  employeeName: "สมชาย",
  periodMonth: "2026-07",
  kind: "bonus",
  dueDate: 2,
  amount: 1200,
  advanceDeduct: 0,
  grossAmount: 1200,
  bonusRemaining: 1200,
  note: "",
  combinedPayId: "",
};

const receipt = buildReceiptFromJustPaid({
  items: [salary, bonus],
  slipUrls: ["https://example.com/slip.jpg"],
  note: "โอนรวม",
  paidAt: Date.parse("2026-07-31T10:00:00+07:00"),
  combinedPayId: "c_e1_2026-07_1",
});

assert.equal(receipt.combined, true);
assert.equal(receipt.transferTotal, 6200);
assert.equal(receipt.advanceDeductTotal, 500);
assert.equal(receipt.key, "c_e1_2026-07_1");
assert.equal(receipt.lines.length, 2);

const html = buildPayrollPaymentDocHtml({
  receipt,
  shop: {
    shopName: "TELL TEA",
    shopNameTh: "เทล ที",
    taxId: "1234567890123",
  },
  payee: { employeeName: "สมชาย", payBank: "กสิกร", payAccountNo: "123" },
});

assert.match(html, /TELL TEA/);
assert.match(html, /เทล ที/);
assert.match(html, /1234567890123/);
assert.match(html, /สมชาย/);
assert.match(html, /สิ้นเดือน/);
assert.match(html, /โบนัส/);
assert.match(html, /6200/);
assert.match(html, /ไม่ใช่ใบหักภาษี ณ ที่จ่าย/);
assert.doesNotMatch(html, /<script/);

console.log("test-payroll-payment-doc: ok");
