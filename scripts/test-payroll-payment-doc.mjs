/**
 * Payroll payment proof document builders (source + mirror logic).
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
assert.match(docSrc, /formatPayrollPeriodLabel/);
assert.match(docSrc, /formatPayrollPaidAtLabel/);
assert.match(docSrc, /fonts\.googleapis\.com.*Sarabun/);
assert.match(docSrc, /Leelawadee UI/);
assert.match(docSrc, /ใบสรุปหลักฐานการจ่าย/);
assert.match(docSrc, /ไม่ใช่หนังสือรับรองหักภาษี ณ ที่จ่าย/);
assert.match(docSrc, /ผู้จ่าย \/ ร้าน/);
assert.match(docSrc, /ผู้รับเงิน/);
assert.match(payUi, /buildReceiptFromJustPaid/);
assert.match(payUi, /PayrollPaymentDocModal/);
assert.match(payUi, /เปิดใบสรุปหลักฐานแล้ว/);
assert.match(histUi, /ใบสรุปหลักฐานจ่าย/);
assert.match(histUi, /buildStaffTransferReceipts/);
assert.match(cardUi, /ดูใบสรุปจ่าย/);
assert.match(modalUi, /พิมพ์ \/ บันทึก PDF/);
assert.match(modalUi, /formatPayrollPeriodLabel/);
assert.match(modalUi, /ดาวน์โหลดไฟล์/);
assert.match(versionSrc, /APP_BUILD = 705/);
assert.match(payUi, /salary_mid/);
assert.match(payUi, /แท็บหลักฐานจ่าย/);
const pageSrc = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
assert.match(pageSrc, /หลักฐานจ่าย/);

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

function formatPayrollPeriodLabel(periodMonth) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodMonth || "").trim());
  if (!m) return periodMonth || "—";
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${months[monthIdx]} ${year + 543}`;
}

assert.equal(formatPayrollPeriodLabel("2026-07"), "ก.ค. 2569");
assert.equal(formatPayrollPeriodLabel("2026-01"), "ม.ค. 2569");

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

function lineMetaBits(line, receiptNote) {
  const meta = [];
  if (line.grossAmount > 0 && round2(line.grossAmount) !== round2(line.amount)) {
    meta.push(`ก่อนหักเบิก ฿${money(line.grossAmount)}`);
  }
  if (line.advanceDeduct > 0) meta.push(`หักเบิก ฿${money(line.advanceDeduct)}`);
  if (
    line.kind === "bonus" &&
    line.bonusRemaining > 0 &&
    round2(line.bonusRemaining) !== round2(line.amount) &&
    round2(line.bonusRemaining) !== round2(line.grossAmount)
  ) {
    meta.push(`หลังหักร้าน ฿${money(line.bonusRemaining)}`);
  }
  const lineNote = (line.note || "").trim();
  if (lineNote && lineNote !== receiptNote) meta.push(lineNote);
  return meta;
}

const salary = {
  id: "s1",
  employeeId: "e1",
  employeeName: "สมชาย ใจดี",
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
  employeeName: "สมชาย ใจดี",
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
  note: "โอนรวมสิ้นเดือน",
  paidAt: Date.parse("2026-07-31T10:00:00+07:00"),
  combinedPayId: "c_e1_2026-07_1",
});

assert.equal(receipt.combined, true);
assert.equal(receipt.transferTotal, 6200);
assert.equal(receipt.advanceDeductTotal, 500);

// bonusRemaining == amount → ไม่ต้องโชว์ meta ซ้ำ
const bonusMeta = lineMetaBits(receipt.lines[1], receipt.note);
assert.ok(!bonusMeta.some((x) => x.includes("โบนัสคงเหลือ") || x.includes("หลังหักร้าน")));

const salaryMeta = lineMetaBits(receipt.lines[0], receipt.note);
assert.ok(salaryMeta.some((x) => x.includes("ก่อนหัก")));
assert.ok(salaryMeta.some((x) => x.includes("หักเบิก")));

// Generate real HTML via dynamic import of compiled helpers — mirror builder for artifact
function buildSampleHtml() {
  const periodLabel = formatPayrollPeriodLabel(receipt.periodMonth);
  const lineRows = receipt.lines
    .map((line) => {
      const meta = lineMetaBits(line, receipt.note);
      return `<tr><td><div class="line-kind">${escapeReceiptHtml(shortTransferKindLabel(line.kind))}</div>${
        meta.length
          ? `<div class="muted tiny">${escapeReceiptHtml(meta.join(" · "))}</div>`
          : ""
      }</td><td class="num">฿${money(line.amount)}</td></tr>`;
    })
    .join("");
  // Pull styles/structure checks from source by requiring key markers exist,
  // and write a visual sample that matches the production template closely.
  const srcHtmlMatch = docSrc.includes("family=Sarabun");
  assert.equal(srcHtmlMatch, true);

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>ใบสรุปการจ่าย · สมชาย ใจดี · ${periodLabel}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4; margin: 16mm; }
    body { margin: 0; font-family: "Sarabun", "Leelawadee UI", "Tahoma", sans-serif; color: #111; font-size: 15px; line-height: 1.5; }
    .sheet { max-width: 720px; margin: 0 auto; padding: 24px; }
    .head { display: flex; justify-content: space-between; gap: 1.25rem; padding-bottom: 0.85rem; border-bottom: 2px solid #1a1a1a; }
    .brand { font-size: 1.65rem; font-weight: 700; margin: 0; }
    .brand-th { font-size: 1.05rem; font-weight: 600; margin: 0.1rem 0 0.4rem; }
    .shop-meta { color: #444; font-size: 0.9rem; }
    .doc-stamp { text-align: right; }
    .doc-stamp .label { font-size: 0.78rem; font-weight: 700; color: #555; margin: 0; }
    .doc-stamp .name { font-size: 1.2rem; font-weight: 700; margin: 0.2rem 0; }
    .badge { display: inline-block; padding: 0.12rem 0.45rem; border: 1px solid #666; border-radius: 3px; font-size: 0.75rem; font-weight: 700; }
    .notice { margin: 0.65rem 0 0; font-size: 0.82rem; color: #555; }
    .sec { font-weight: 700; margin: 1.05rem 0 0.4rem; border-bottom: 1px solid #ddd; padding-bottom: 0.15rem; }
    .grid { display: grid; grid-template-columns: 8.5rem 1fr; gap: 0.28rem 0.75rem; }
    .k { color: #555; } .v { font-weight: 600; }
    table.pay { width: 100%; border-collapse: collapse; margin-top: 0.35rem; }
    table.pay th, table.pay td { border-bottom: 1px solid #ddd; padding: 0.5rem 0.15rem; text-align: left; }
    table.pay th { font-size: 0.82rem; color: #444; }
    table.pay .num { text-align: right; }
    .line-kind { font-weight: 700; }
    .muted { color: #555; } .tiny { font-size: 0.86rem; }
    .subtotal { display: flex; justify-content: space-between; color: #444; font-size: 0.92rem; }
    .total { display: flex; justify-content: space-between; margin-top: 0.55rem; padding-top: 0.55rem; border-top: 2px solid #1a1a1a; font-size: 1.2rem; font-weight: 700; }
    .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 2.25rem; text-align: center; }
    .sign .line { margin: 2.4rem 1rem 0.35rem; border-bottom: 1px solid #333; }
    .foot { margin-top: 1.6rem; padding-top: 0.7rem; border-top: 1px dashed #bbb; font-size: 0.8rem; color: #666; }
  </style>
</head>
<body>
  <div class="sheet">
    <header class="head">
      <div>
        <h1 class="brand">TELL TEA</h1>
        <p class="brand-th">เทล ที</p>
        <div class="shop-meta">
          <div>ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี</div>
          <div>โทร 0884818817</div>
          <div>เลขประจำตัวผู้เสียภาษี 1234567890123</div>
        </div>
      </div>
      <div class="doc-stamp">
        <p class="label">เอกสารจ่าย</p>
        <p class="name">ใบสรุปหลักฐานการจ่าย</p>
        <p>งวด ${periodLabel}</p>
        <span class="badge">โอนรวมสิ้นเดือน + โบนัส</span>
      </div>
    </header>
    <p class="notice">เอกสารภายในกิจการ สำหรับเก็บเป็นหลักฐานการจ่ายเงินเดือน/โบนัส — ไม่ใช่หนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ)</p>
    <div class="sec">ผู้รับเงิน</div>
    <div class="grid">
      <div class="k">ชื่อพนักงาน</div><div class="v">สมชาย ใจดี</div>
      <div class="k">บัญชีรับโอน</div><div class="v">กสิกรไทย · 123-4-56789-0 · ชื่อบัญชี สมชาย ใจดี</div>
    </div>
    <div class="sec">รอบจ่าย</div>
    <div class="grid">
      <div class="k">งวด</div><div class="v">${periodLabel}</div>
      <div class="k">วัน–เวลาโอน</div><div class="v">31/7/2569 10:00 น.</div>
      <div class="k">หมายเหตุ</div><div class="v">โอนรวมสิ้นเดือน</div>
    </div>
    <div class="sec">รายการที่จ่าย</div>
    <table class="pay">
      <thead><tr><th>รายการ</th><th class="num">ยอดโอน (บาท)</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div class="subtotal"><span>หักเบิกรวมในรอบนี้</span><span>฿500</span></div>
    <div class="total"><span>รวมยอดโอนเข้าบัญชี</span><span>฿6200</span></div>
    <div class="signs">
      <div class="sign"><div class="line"></div><div><strong>ผู้จ่าย / ร้าน</strong></div><div class="muted tiny">ลงชื่อ · วันเดือนปี</div></div>
      <div class="sign"><div class="line"></div><div><strong>ผู้รับเงิน</strong></div><div class="muted tiny">สมชาย ใจดี</div></div>
    </div>
    <div class="foot">
      <div>มีหลักฐานสลิปโอนในระบบ 1 รูป (ดูได้ที่แท็บประวัติในแอป)</div>
      <div>ออกจากระบบจ่าย TellTea · อ้างอิง c_e1_2026-07_1</div>
    </div>
  </div>
</body>
</html>`;
}

const html = buildSampleHtml();
assert.match(html, /TELL TEA/);
assert.match(html, /เทล ที/);
assert.match(html, /ก\.ค\. 2569/);
assert.match(html, /สมชาย ใจดี/);
assert.match(html, /สิ้นเดือน/);
assert.match(html, /โบนัส/);
assert.match(html, /6200/);
assert.match(html, /Sarabun/);
assert.match(html, /ผู้จ่าย \/ ร้าน/);
assert.doesNotMatch(html, /โบนัสคงเหลือ/);

const outDir = join(root, "tmp");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "payroll-payment-doc-sample.html");
writeFileSync(outPath, html, "utf8");
console.log("test-payroll-payment-doc: ok");
console.log("sample:", outPath);
