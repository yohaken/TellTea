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
const settingsSrc = readFileSync(
  join(root, "src/lib/payroll-payment-doc-settings.ts"),
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
const settingsUi = readFileSync(
  join(root, "src/components/PayrollSettingsPanel.tsx"),
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
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(docSrc, /buildPayrollPaymentDocHtml/);
assert.match(docSrc, /buildReceiptFromJustPaid/);
assert.match(docSrc, /printPayrollPaymentDoc/);
assert.match(docSrc, /downloadPayrollPaymentDoc/);
assert.match(docSrc, /shopFromPosSettings/);
assert.match(docSrc, /formatPayrollPeriodLabel/);
assert.match(docSrc, /formatPayrollPaidAtLabel/);
assert.match(docSrc, /fonts\.googleapis\.com.*Sarabun/);
assert.match(docSrc, /TH Sarabun New/);
assert.match(docSrc, /รายได้/);
assert.match(docSrc, /รายการหัก/);
assert.match(docSrc, /ยอดโอนรอบนี้/);
assert.match(docSrc, /@page \{ size: A4/);
assert.match(docSrc, /แบบ ๕๐ ทวิ/);
assert.match(docSrc, /ชื่อจริง–นามสกุล/);
assert.match(docSrc, /ผู้รับเงิน/);
assert.match(docSrc, /legalNameForPaymentDoc/);
assert.match(docSrc, /ยอดโอนรอบนี้ \(ตัวอักษร\)/);
assert.match(docSrc, /thaiBahtText/);
assert.match(docSrc, /buildMonthPaymentSummary/);
assert.match(docSrc, /listMonthPaymentSummaries/);
assert.match(docSrc, /buildMonthPaymentDocHtml/);
assert.match(docSrc, /buildMonthPaymentDocsBundleHtml/);
assert.match(docSrc, /อัตราเงินเดือนเต็ม/);
assert.match(docSrc, /หักคืนเบิกล่วงหน้า|คืนเบิกล่วงหน้า/);
assert.match(docSrc, /รวมเงินที่พนักงานได้รับทั้งงวด/);
assert.match(docSrc, /midGross/);
assert.match(docSrc, /legalFullName/);
assert.match(docSrc, /payslipIncomeDeductHtml/);
assert.match(settingsSrc, /พีระพงษ์ โยหาเคน/);
assert.match(settingsSrc, /payrollPaymentDoc/);
assert.match(settingsUi, /เอกสารหลักฐานจ่าย/);
assert.match(settingsUi, /ชื่อผู้จ่าย/);
assert.match(settingsUi, /ตำแหน่ง \/ อื่นๆ/);
assert.match(payUi, /buildReceiptFromJustPaid/);
assert.match(payUi, /PayrollPaymentDocModal/);
assert.match(payUi, /เปิดใบสรุปหลักฐานแล้ว/);
assert.match(payUi, /linkedStaffId/);
assert.match(histUi, /ดาวน์โหลดเอกสาร/);
assert.doesNotMatch(histUi, /ดาวน์โหลดเอกสาร A4/);
assert.match(histUi, /buildMonthPaymentSummary/);
assert.match(histUi, /legalNameForPaymentDoc/);
assert.match(histUi, /listStaffPersonalMap/);
assert.match(histUi, /getStaffPersonal/);
assert.match(histUi, /payroll-doc-dl-btn/);
assert.match(histUi, /ดาวน์โหลด PDF/);
assert.match(cardUi, /หลักฐานจ่าย|ดาวน์โหลดเอกสาร/);
assert.match(modalUi, /formatPayrollPeriodLabel/);
assert.match(modalUi, /ดาวน์โหลดเอกสาร/);
assert.match(modalUi, /getStaffPersonal/);
assert.match(modalUi, /ไฟล์ PDF/);
assert.doesNotMatch(modalUi, /พิมพ์ A4/);
assert.match(versionSrc, /APP_BUILD = 713/);
assert.match(docSrc, /width: 210mm/);
assert.match(docSrc, /min-height: 297mm/);
assert.match(docSrc, /downloadPayrollPaymentDocPdf/);
assert.match(docSrc, /import\("jspdf"\)/);
assert.match(docSrc, /import\("html2canvas"\)/);
assert.match(docSrc, /\.pdf`/);
assert.doesNotMatch(docSrc, /downloadPayrollPaymentDocHtml/);
assert.match(payUi, /salary_mid/);
assert.match(payUi, /แท็บหลักฐานจ่าย/);
assert.match(rulesSrc, /payrollPaymentDoc/);
const pageSrc = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
assert.match(pageSrc, /หลักฐานจ่าย/);
assert.match(pageSrc, /shopView=\{showShopUi && uiIsOwner\}/);
assert.match(histUi, /ทั้งร้าน/);
assert.doesNotMatch(histUi, /พิมพ์ทั้งร้าน/);
const pkg = readFileSync(join(root, "package.json"), "utf8");
assert.match(pkg, /"jspdf"/);
assert.match(pkg, /"html2canvas"/);

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

function legalFullName(payee) {
  const full = [payee.legalFirstName, payee.legalLastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  return full || (payee.employeeName || "").trim() || "—";
}

function buildMonthPaymentSummary(items, employeeId, periodMonth, opts) {
  const paid = items.filter(
    (i) =>
      i.employeeId === employeeId &&
      i.periodMonth === periodMonth &&
      i.status === "paid",
  );
  if (!paid.length) return null;
  let salaryFull = 0;
  let midAmount = 0;
  let midGross = 0;
  let midAdvance = 0;
  let endAmount = 0;
  let endGross = 0;
  let endAdvance = 0;
  let bonusAmount = 0;
  let bonusGross = 0;
  let bonusAdvance = 0;
  for (const row of paid) {
    if (row.kind === "salary_mid" || row.kind === "salary_month_end") {
      salaryFull = Math.max(salaryFull, round2(row.salaryBase || 0));
    }
    const gross = round2(
      Number(row.grossAmount) > 0
        ? row.grossAmount
        : row.amount + (row.advanceDeduct || 0),
    );
    if (row.kind === "salary_mid") {
      midAmount = round2(midAmount + row.amount);
      midGross = round2(midGross + gross);
      midAdvance = round2(midAdvance + (row.advanceDeduct || 0));
    } else if (row.kind === "salary_month_end") {
      endAmount = round2(endAmount + row.amount);
      endGross = round2(endGross + gross);
      endAdvance = round2(endAdvance + (row.advanceDeduct || 0));
    } else if (row.kind === "bonus") {
      bonusAmount = round2(bonusAmount + row.amount);
      bonusGross = round2(bonusGross + gross);
      bonusAdvance = round2(bonusAdvance + (row.advanceDeduct || 0));
    }
  }
  if (!(salaryFull > 0)) {
    const hint = round2(Number(opts?.monthlySalaryHint) || 0);
    if (hint > 0) salaryFull = hint;
  }
  const advanceDeductTotal = round2(midAdvance + endAdvance + bonusAdvance);
  return {
    employeeId,
    employeeName: paid[0].employeeName,
    periodMonth,
    salaryFull,
    midAmount,
    midGross,
    endAmount,
    endGross,
    bonusAmount,
    bonusGross,
    advanceDeductTotal,
    transferTotal: round2(midAmount + endAmount + bonusAmount),
    grossTotal: round2(midGross + endGross + bonusGross),
  };
}

const monthItems = [
  {
    id: "m1",
    employeeId: "e1",
    employeeName: "แป๋ม",
    periodMonth: "2026-07",
    kind: "salary_mid",
    status: "paid",
    amount: 5000,
    grossAmount: 5000,
    salaryBase: 10000,
    advanceDeduct: 0,
  },
  {
    id: "e1end",
    employeeId: "e1",
    employeeName: "แป๋ม",
    periodMonth: "2026-07",
    kind: "salary_month_end",
    status: "paid",
    amount: 2000,
    grossAmount: 5000,
    salaryBase: 10000,
    advanceDeduct: 3000,
  },
  {
    id: "b1",
    employeeId: "e1",
    employeeName: "แป๋ม",
    periodMonth: "2026-07",
    kind: "bonus",
    status: "paid",
    amount: 1200,
    grossAmount: 1200,
    salaryBase: 0,
    advanceDeduct: 0,
  },
];
const monthSummary = buildMonthPaymentSummary(monthItems, "e1", "2026-07");
assert.equal(monthSummary.salaryFull, 10000);
assert.equal(monthSummary.midGross, 5000);
assert.equal(monthSummary.endGross, 5000);
assert.equal(monthSummary.endAmount, 2000);
assert.equal(monthSummary.advanceDeductTotal, 3000);
assert.equal(monthSummary.bonusGross, 1200);
assert.equal(monthSummary.grossTotal, 11200);
assert.equal(monthSummary.transferTotal, 8200);

const hintOnly = buildMonthPaymentSummary(
  monthItems.map((r) => ({ ...r, salaryBase: 0 })),
  "e1",
  "2026-07",
  { monthlySalaryHint: 10000 },
);
assert.equal(hintOnly.salaryFull, 10000);

assert.equal(
  legalFullName({
    employeeName: "น้องเอ",
    legalFirstName: "สมชาย",
    legalLastName: "ใจดี",
  }),
  "สมชาย ใจดี",
);

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
    meta.push(`ก่อนหัก ฿${money(line.grossAmount)}`);
  }
  if (line.advanceDeduct > 0) {
    meta.push(`คืนเบิก ฿${money(line.advanceDeduct)} (ได้ไปก่อนแล้ว)`);
  }
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

const bonusMeta = lineMetaBits(receipt.lines[1], receipt.note);
assert.ok(!bonusMeta.some((x) => x.includes("โบนัสคงเหลือ") || x.includes("หลังหักร้าน")));

const salaryMeta = lineMetaBits(receipt.lines[0], receipt.note);
assert.ok(salaryMeta.some((x) => x.includes("ก่อนหัก")));
assert.ok(salaryMeta.some((x) => x.includes("คืนเบิก")));

function buildSampleHtml() {
  const recipient = "สมชาย ใจดี";
  const payerName = "พีระพงษ์ โยหาเคน";
  assert.equal(docSrc.includes("family=Sarabun"), true);
  assert.match(docSrc, /@page \{ size: A4/);

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>หลักฐานการจ่ายค่าจ้าง · ${recipient} · ก.ค. 2569</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4; margin: 18mm 16mm 18mm 18mm; }
    body { margin: 0; font-family: "Sarabun", "TH Sarabun New", "Cordia New", sans-serif; color: #111; font-size: 16px; line-height: 1.55; }
    .sheet { max-width: 190mm; margin: 0 auto; padding: 12px; }
    .letterhead { text-align: center; }
    .org-name { font-size: 1.55rem; font-weight: 700; margin: 0; }
    .org-name-th { font-size: 1.15rem; font-weight: 600; margin: 0.1rem 0 0.35rem; }
    .rule { border-top: 2.2px solid #111; border-bottom: 0.7px solid #111; height: 4px; margin: 0.65rem 0 0.85rem; }
    .doc-title { text-align: center; font-size: 1.35rem; font-weight: 700; text-decoration: underline; }
    .body-text { text-indent: 2.5rem; text-align: justify; }
    table.info, table.items, table.sum { width: 100%; border-collapse: collapse; margin: 0.4rem 0; }
    table.info th, table.info td, table.items th, table.items td, table.sum td { border: 1px solid #222; padding: 0.4rem 0.5rem; }
    table.info th, table.items thead th { background: #f3f3f3; }
    .num { text-align: right; }
    .words { border: 1px solid #222; padding: 0.55rem 0.65rem; margin: 0.5rem 0; }
    .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 1.75rem; text-align: center; }
    .sign .blank { margin: 2.1rem 1.1rem 0.35rem; border-bottom: 1px solid #222; }
    .foot { margin-top: 1.5rem; border-top: 1px solid #999; font-size: 0.82rem; color: #444; }
  </style>
</head>
<body>
  <div class="sheet">
    <header class="letterhead">
      <h1 class="org-name">TELL TEA</h1>
      <div class="org-name-th">เทล ที</div>
      <p>ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี<br/>โทรศัพท์ 0884818817</p>
    </header>
    <hr class="rule" />
    <h2 class="doc-title">หลักฐานการจ่ายค่าจ้างและเงินเดือน</h2>
    <p class="body-text">หนังสือฉบับนี้ขอรับรองว่า เทล ที / TELL TEA ได้จ่ายค่าจ้าง เงินเดือน และ/หรือค่าตอบแทน ให้แก่ <strong>${recipient}</strong> สำหรับงวด กรกฎาคม พ.ศ. 2569 ตามรายการด้านล่าง</p>
    <div class="sec">๑. คู่กรณีและข้อมูลการจ่าย</div>
    <table class="info">
      <tr><th>ผู้รับเงิน (ชื่อจริง–นามสกุล)</th><td>${recipient}</td></tr>
      <tr><th>ผู้จ่ายเงิน</th><td>${payerName} · เจ้าของกิจการ</td></tr>
      <tr><th>อัตราเงินเดือนเต็ม (อ้างอิง)</th><td>10000 บาท</td></tr>
    </table>
    <div class="sec">๒. รายการที่ถึงกำหนดและยอดสุทธิ</div>
    <table class="items">
      <thead><tr><th>ลำดับ</th><th>รายการ</th><th class="num">จำนวนเงิน (บาท)</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>ค่าจ้างรอบกลางเดือน</td><td class="num">5000</td></tr>
        <tr><td>2</td><td>ค่าจ้างรอบสิ้นเดือน</td><td class="num">5000</td></tr>
        <tr><td>3</td><td>เงินโบนัส / ค่าตอบแทนอื่น</td><td class="num">1200</td></tr>
      </tbody>
    </table>
    <table class="sum">
      <tr><td>รวมก่อนหักคืนเบิก</td><td class="num">11200</td></tr>
      <tr><td>หัก คืนเบิกล่วงหน้า</td><td class="num">(3000)</td></tr>
      <tr><td><strong>จำนวนเงินสุทธิที่โอนเข้าบัญชี</strong></td><td class="num"><strong>8200</strong></td></tr>
    </table>
    <div class="words"><strong>จำนวนเงินสุทธิ (ตัวอักษร)</strong> แปดพันสองร้อยบาทถ้วน</div>
    <div class="sec">๓. การรับรอง</div>
    <div class="signs">
      <div class="sign"><div class="blank"></div><div>(${payerName})</div><div>ผู้จ่ายเงิน</div></div>
      <div class="sign"><div class="blank"></div><div>(${recipient})</div><div>ผู้รับเงิน</div></div>
    </div>
    <div class="foot">หมายเหตุ: ไม่ใช่หนังสือรับรองการหักภาษี ณ ที่จ่าย (แบบ ๕๐ ทวิ) และไม่ใช่ใบเสร็จรับเงิน</div>
  </div>
</body>
</html>`;
}

const html = buildSampleHtml();
assert.match(html, /TELL TEA/);
assert.match(html, /เทล ที/);
assert.match(html, /หลักฐานการจ่ายค่าจ้างและเงินเดือน/);
assert.match(html, /สมชาย ใจดี/);
assert.match(html, /ค่าจ้างรอบกลางเดือน/);
assert.match(html, /ค่าจ้างรอบสิ้นเดือน/);
assert.match(html, /โบนัส/);
assert.match(html, /อัตราเงินเดือนเต็ม/);
assert.match(html, /11200/);
assert.match(html, /8200/);
assert.match(html, /คืนเบิกล่วงหน้า/);
assert.match(html, /แปดพันสองร้อยบาทถ้วน/);
assert.match(html, /Sarabun/);
assert.match(html, /@page \{ size: A4/);
assert.match(html, /พีระพงษ์ โยหาเคน/);
assert.match(html, /ชื่อจริง–นามสกุล/);
assert.match(html, /จำนวนเงินสุทธิที่โอนเข้าบัญชี/);
assert.match(html, /แบบ ๕๐ ทวิ/);

const outDir = join(root, "tmp");
mkdirSync(outDir, { recursive: true });
const outPath = join(root, "tmp", "payroll-payment-doc-sample.html");
writeFileSync(outPath, html, "utf8");
console.log("test-payroll-payment-doc: ok");
console.log("sample:", outPath);
