/**
 * Payroll history summaries + bonus deduction evidence wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const histSrc = readFileSync(join(root, "src/lib/payroll-history.ts"), "utf8");
const deductSrc = readFileSync(join(root, "src/lib/bonus-deductions.ts"), "utf8");
const histUi = readFileSync(join(root, "src/components/PayrollHistoryPanel.tsx"), "utf8");
const evidenceUi = readFileSync(
  join(root, "src/components/BonusDeductionEvidencePanel.tsx"),
  "utf8",
);
const payUi = readFileSync(join(root, "src/components/PayrollPayPanel.tsx"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(histSrc, /buildPayrollMonthSummaries/);
assert.match(histSrc, /filterEmployeePayrollItems/);
assert.match(histSrc, /paidComplete/);

assert.match(deductSrc, /evidenceUrls/);
assert.match(deductSrc, /saveBonusDeductionMonthEvidence/);
assert.match(deductSrc, /BONUS_DEDUCTION_EVIDENCE_MAX/);
assert.match(deductSrc, /merge: true/);

assert.match(histUi, /PayrollHistoryPanel/);
assert.match(histUi, /EntryPhotoIndicator/);
assert.match(histUi, /สลิป/);

assert.match(evidenceUi, /หลักฐานโบนัส/);
assert.match(evidenceUi, /PhotoAttachMultiField/);
assert.match(evidenceUi, /bonus-deductions/);

assert.match(payUi, /payroll-col-slip/);
assert.match(payUi, /slipPreview/);

assert.match(pageSrc, /history/);
assert.match(pageSrc, /PayrollHistoryPanel/);
assert.match(pageSrc, /BonusDeductionEvidencePanel/);
assert.match(pageSrc, /ประวัติ/);

assert.match(versionSrc, /APP_BUILD = \d+/);

// Pure summary logic (mirror)
function round2(n) {
  return Math.round(n * 100) / 100;
}
function buildPayrollMonthSummaries(items) {
  const byMonth = new Map();
  for (const item of items) {
    if (!item.periodMonth || item.status === "void") continue;
    const list = byMonth.get(item.periodMonth) || [];
    list.push(item);
    byMonth.set(item.periodMonth, list);
  }
  return [...byMonth.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((periodMonth) => {
      const rows = byMonth.get(periodMonth);
      let paidTotal = 0;
      let pendingTotal = 0;
      let bonusPaid = 0;
      for (const row of rows) {
        if (row.status === "paid") {
          paidTotal += row.amount;
          if (row.kind === "bonus") bonusPaid += row.amount;
        } else if (row.status === "pending") pendingTotal += row.amount;
      }
      paidTotal = round2(paidTotal);
      pendingTotal = round2(pendingTotal);
      return {
        periodMonth,
        bonusPaid: round2(bonusPaid),
        paidTotal,
        pendingTotal,
        paidComplete: paidTotal > 0 && pendingTotal === 0,
      };
    });
}

const sample = [
  {
    periodMonth: "2026-06",
    kind: "salary_mid",
    status: "paid",
    amount: 5000,
  },
  {
    periodMonth: "2026-06",
    kind: "bonus",
    status: "paid",
    amount: 1200,
  },
  {
    periodMonth: "2026-07",
    kind: "salary_mid",
    status: "pending",
    amount: 5000,
  },
  {
    periodMonth: "2026-06",
    kind: "salary_month_end",
    status: "void",
    amount: 5000,
  },
];

const sums = buildPayrollMonthSummaries(sample);
assert.equal(sums[0].periodMonth, "2026-07");
assert.equal(sums[1].periodMonth, "2026-06");
assert.equal(sums[1].paidTotal, 6200);
assert.equal(sums[1].bonusPaid, 1200);
assert.equal(sums[1].paidComplete, true);
assert.equal(sums[0].paidComplete, false);

console.log("OK test-payroll-history");
