/**
 * Staff transfer receipt + combined clipboard helpers (source + mirror logic).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const receiptSrc = readFileSync(
  join(root, "src/lib/payroll-staff-receipt.ts"),
  "utf8",
);
const histSrc = readFileSync(join(root, "src/lib/payroll-history.ts"), "utf8");
const payUi = readFileSync(join(root, "src/components/PayrollPayPanel.tsx"), "utf8");
const cardUi = readFileSync(
  join(root, "src/components/StaffLatestTransferCard.tsx"),
  "utf8",
);
const histUi = readFileSync(
  join(root, "src/components/PayrollHistoryPanel.tsx"),
  "utf8",
);
const pageSrc = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const checklist = readFileSync(
  join(root, "docs/payroll-staff-pay-golive-checklist.md"),
  "utf8",
);

assert.match(receiptSrc, /findLatestStaffTransferReceipt/);
assert.match(receiptSrc, /buildCombinedTransferClipboard/);
assert.match(receiptSrc, /combinedPayId/);
assert.match(histSrc, /salaryHistoryMetaBits/);
assert.match(histSrc, /findCombinedTransferTotal/);
assert.match(payUi, /StaffLatestTransferCard/);
assert.match(payUi, /คัดลอกเลขบัญชี/);
assert.match(payUi, /คัดลอกยอด/);
assert.match(receiptSrc, /digitsOnlyAccount/);
assert.match(receiptSrc, /plainTransferAmount/);
assert.match(cardUi, /รอบล่าสุด · เข้าบัญชีคุณ/);
assert.match(cardUi, /สรุปโบนัส \+ หลักฐานหัก/);
assert.match(histUi, /โอนครั้งเดียว/);
assert.match(histUi, /salaryHistoryMetaBits/);
assert.match(pageSrc, /มุมพนักงาน/);
assert.match(pageSrc, /onOpenBonusMonth/);
assert.match(versionSrc, /APP_BUILD = \d+/);
assert.match(checklist, /ขึ้นหน้าเว็บจริง/);

function digitsOnlyAccount(payAccountNo) {
  return String(payAccountNo || "").replace(/\D/g, "");
}
function plainTransferAmount(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}
assert.equal(digitsOnlyAccount("123-4-56789-0"), "1234567890");
assert.equal(plainTransferAmount(6200), "6200.00");
assert.equal(
  `${digitsOnlyAccount("123-4-56789-0")}\n${plainTransferAmount(6200)}`,
  "1234567890\n6200.00",
);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function buildStaffTransferReceipts(items) {
  const paid = items.filter((i) => i.status === "paid");
  const byCombined = new Map();
  const singles = [];
  for (const item of paid) {
    const cid = (item.combinedPayId || "").trim();
    if (cid) {
      const list = byCombined.get(cid) || [];
      list.push(item);
      byCombined.set(cid, list);
    } else singles.push(item);
  }
  const receipts = [];
  for (const [cid, group] of byCombined) {
    const transferTotal = round2(group.reduce((s, i) => s + i.amount, 0));
    const paidAt = Math.max(...group.map((i) => i.paidAt || 0));
    receipts.push({
      key: cid,
      combined: true,
      periodMonth: group[0].periodMonth,
      paidAt,
      transferTotal,
      lines: group,
    });
  }
  for (const item of singles) {
    receipts.push({
      key: item.id,
      combined: false,
      periodMonth: item.periodMonth,
      paidAt: item.paidAt || 0,
      transferTotal: item.amount,
      lines: [item],
    });
  }
  return receipts.sort((a, b) => b.paidAt - a.paidAt);
}

const sample = [
  {
    id: "s1",
    status: "paid",
    kind: "salary_month_end",
    amount: 5000,
    combinedPayId: "c1",
    periodMonth: "2026-07",
    paidAt: 100,
  },
  {
    id: "b1",
    status: "paid",
    kind: "bonus",
    amount: 1200,
    combinedPayId: "c1",
    periodMonth: "2026-07",
    paidAt: 100,
  },
  {
    id: "m1",
    status: "paid",
    kind: "salary_mid",
    amount: 4000,
    combinedPayId: "",
    periodMonth: "2026-07",
    paidAt: 50,
  },
];

const receipts = buildStaffTransferReceipts(sample);
assert.equal(receipts[0].combined, true);
assert.equal(receipts[0].transferTotal, 6200);
assert.equal(receipts[1].transferTotal, 4000);

console.log("test-payroll-staff-receipt: ok");
