import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const reportSrc = readFileSync(join(root, "src/lib/pos-shift-report.ts"), "utf8");
assert.match(reportSrc, /buildShiftReportDetail/);
assert.match(reportSrc, /byCategory/);
assert.match(reportSrc, /byItem/);
assert.match(reportSrc, /voidedBills/);
assert.match(reportSrc, /discountTotal/);
assert.match(reportSrc, /avgPerBill/);
assert.match(reportSrc, /receipts\?:/);

const templateSrc = readFileSync(join(root, "src/lib/pos-printer/shift-snapshot-template.ts"), "utf8");
assert.match(templateSrc, /ยอดขายตามหมวดหมู่/);
assert.match(templateSrc, /สรุปยอด/);
assert.match(templateSrc, /ส่วนลด &amp; โปรโมชั่น/);
assert.match(templateSrc, /ยอดขายตามการชำระเงิน/);
assert.match(templateSrc, /ยอดขายตามประเภทออเดอร์/);
assert.match(templateSrc, /รอบการขาย \(เงินสด\)/);
assert.match(templateSrc, /รายการขายแยกตามบิล/);
assert.match(templateSrc, /ยอดขายตามรายการ/);
assert.match(templateSrc, /ทำลายบิล \/ ยกเลิก/);

const localSrc = readFileSync(join(root, "src/lib/pos-local-receipts.ts"), "utf8");
assert.match(localSrc, /discountBaht\?:/);
assert.match(localSrc, /menuItemId\?:/);
assert.match(localSrc, /categoryName\?:/);

const sellSrc = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sellSrc, /discountBaht: discountBaht > 0 \? discountBaht : undefined/);

const shiftSrc = readFileSync(join(root, "src/components/PosShiftView.tsx"), "utf8");
assert.match(shiftSrc, /loadPosMenuCache/);
assert.match(shiftSrc, /receipts: sessionReceipts/);
assert.match(shiftSrc, /receipts: closedReceipts/);
assert.match(shiftSrc, /receipts: sales/);

const versionSrc = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(versionSrc, /POS_BUILD = 41/);

// Pure aggregation mirror for numeric checks
function round2(n) {
  return Math.round(n * 100) / 100;
}

function buildDetail(receipts, menu) {
  const catById = new Map((menu?.categories || []).map((c) => [c.id, c.name]));
  const itemById = new Map((menu?.items || []).map((i) => [i.id, i]));
  const active = receipts.filter((r) => !r.voided);
  const catMap = new Map();
  let gross = 0;
  let itemQty = 0;
  for (const r of active) {
    for (const line of r.lines || []) {
      const amount = round2(line.qty * line.unitPrice);
      gross = round2(gross + amount);
      itemQty += line.qty;
      const item = line.menuItemId ? itemById.get(line.menuItemId) : null;
      const catName = item ? catById.get(item.categoryId) || "อื่นๆ" : "อื่นๆ";
      const row = catMap.get(catName) || { name: catName, qty: 0, amount: 0 };
      row.qty += line.qty;
      row.amount = round2(row.amount + amount);
      catMap.set(catName, row);
    }
  }
  const discountTotal = round2(active.reduce((s, r) => s + (r.discountBaht || 0), 0));
  const netSales = round2(active.reduce((s, r) => s + r.total, 0));
  return {
    itemQty,
    grossSales: gross,
    discountTotal,
    netSales,
    customerCount: active.length,
    avgPerBill: active.length ? round2(netSales / active.length) : 0,
    byCategory: [...catMap.values()],
    bills: active.length,
  };
}

const detail = buildDetail(
  [
    {
      total: 90,
      discountBaht: 10,
      voided: false,
      lines: [
        { name: "ชานม", qty: 2, unitPrice: 50, menuItemId: "m1" },
      ],
    },
    {
      total: 55,
      discountBaht: 0,
      voided: false,
      lines: [{ name: "กาแฟ", qty: 1, unitPrice: 55, menuItemId: "m2" }],
    },
    {
      total: 40,
      voided: true,
      lines: [{ name: "ยกเลิก", qty: 1, unitPrice: 40, menuItemId: "m1" }],
    },
  ],
  {
    categories: [
      { id: "c1", name: "ชานม" },
      { id: "c2", name: "กาแฟ" },
    ],
    items: [
      { id: "m1", categoryId: "c1" },
      { id: "m2", categoryId: "c2" },
    ],
  },
);

assert.equal(detail.customerCount, 2);
assert.equal(detail.grossSales, 155);
assert.equal(detail.discountTotal, 10);
assert.equal(detail.netSales, 145);
assert.equal(detail.avgPerBill, 72.5);
assert.equal(detail.itemQty, 3);
assert.equal(detail.byCategory.find((c) => c.name === "ชานม")?.amount, 100);
assert.equal(detail.byCategory.find((c) => c.name === "กาแฟ")?.amount, 55);

console.log("OK pos-shift-detail-report");
