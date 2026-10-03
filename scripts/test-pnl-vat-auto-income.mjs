/**
 * P&L income ดึงจากหน้า VAT อัตโนมัติ — ลำดับแหล่ง + คอลัมน์ VAT + override
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const pnlSrc = read("src/lib/pnl.ts");
const srcSrc = read("src/lib/pnl-vat-source.ts");
const pageSrc = read("src/app/pnl/page.tsx");
const panelSrc = read("src/components/vat-sales/PnlVatIncomePanel.tsx");
const exportSrc = read("src/lib/xlsx-export.ts");

// แหล่ง: ทุกเดือนใน vatMonthlyReturns · รายได้ = ยอดโอนถึงร้าน (incomeTotal)
assert.match(srcSrc, /getDocs\(collection\(getDb\(\), VAT_MONTHLY_COL\)\)/);
assert.match(srcSrc, /view\.incomeTotal/);
assert.match(srcSrc, /outputVat: view\.outputVat/);
assert.match(srcSrc, /netVat: view\.netVat/);

// pnl.ts ไม่ import vat-monthly ตรง ๆ (vat-monthly → pnl อยู่แล้ว)
assert.doesNotMatch(pnlSrc, /from "\.\/vat-monthly"/);
assert.match(pnlSrc, /await import\("\.\/pnl-vat-source"\)/);
assert.match(pnlSrc, /manual: opts\?\.manual === true/);
assert.match(pnlSrc, /profitAfterVat: net - netVat/);
// 2025-04/05 ข้อมูลไม่ครบ — ตัดออกจากทุกตาราง
assert.match(pnlSrc, /PNL_FIRST_MONTH = "2025-06"/);
assert.match(pnlSrc, /staffAll\.filter\(\(r\) => r\.month >= sinceMonth\)/);
assert.match(pnlSrc, /ownerAll\.filter\(\(r\) => r\.month >= sinceMonth\)/);

// หน้า: พิมพ์ทับ = manual · ↺ คืนยอด VAT · คอลัมน์ VAT เฉพาะเจ้าของ · ไม่มีปุ่มส่งแล้ว
assert.match(pageSrc, /saveMonthlyIncome\(month, value, actorId, \{ manual: true \}\)/);
assert.match(pageSrc, /saveMonthlyIncome\(month, vat\.income, actorId, \{ manual: false \}\)/);
assert.match(pageSrc, /isOwner \? \(\s*<>\s*<th className="col-num" title="ภาษีขาย/);
assert.match(pageSrc, /includeVat: isOwner/);
assert.doesNotMatch(panelSrc, /fileVatMonthlyReturn|ใส่รายได้เข้า P&L/);
assert.match(exportSrc, /"VAT สุทธิ": r\.netVat/);

/** Mirror resolvePnlIncome */
function resolvePnlIncome(stored, vat) {
  if (stored?.manual) return { income: stored.income, source: "manual" };
  if (vat && vat.income > 0) return { income: vat.income, source: "vat" };
  if (stored && stored.income > 0) return { income: stored.income, source: "stored" };
  return { income: 0, source: "none" };
}

assert.deepEqual(
  resolvePnlIncome({ income: 363392.75, manual: true }, { income: 92382.81 }),
  { income: 363392.75, source: "manual" },
);
assert.deepEqual(
  resolvePnlIncome({ income: 151490, manual: false }, { income: 286441.91 }),
  { income: 286441.91, source: "vat" },
);
assert.deepEqual(resolvePnlIncome({ income: 379132.68, manual: false }, undefined), {
  income: 379132.68,
  source: "stored",
});
assert.deepEqual(resolvePnlIncome(undefined, { income: 0 }), { income: 0, source: "none" });

const fnBody = pnlSrc.slice(pnlSrc.indexOf("export function resolvePnlIncome"));
assert.ok(
  fnBody.indexOf('source: "manual"') < fnBody.indexOf('source: "vat"') &&
    fnBody.indexOf('source: "vat"') < fnBody.indexOf('source: "stored"'),
  "priority manual → vat → stored",
);

// สรุปกำไร–ขาดทุนอยู่บนสุด · หัวข้อไม่มีเลขนำ
assert.ok(
  pageSrc.indexOf(">สรุปกำไร–ขาดทุน<") < pageSrc.indexOf(">แยกแหล่ง<") &&
    pageSrc.indexOf(">แยกแหล่ง<") < pageSrc.indexOf(">รวม พนง. + เจ้าของ<"),
  "section order",
);
assert.doesNotMatch(pageSrc, /pnl-section-title">\d\)/);

// ทุกตารางเรียงใหม่ → เก่า · กราฟยังรับ viewPnl ตามเวลา
assert.match(pageSrc, /newestFirst\(rows\)\.map/);
assert.match(pageSrc, /newestFirst\(viewPnl\)\.map/);

// กราฟเหนือตาราง P&L — legend toggle · แกนค่าจริงรวมติดลบ · เส้นขาดเดือนไม่มี VAT
const chartSrc = read("src/components/PnlTrendChart.tsx");
assert.match(pageSrc, /<PnlTrendChart rows=\{viewPnl\} isOwner=\{isOwner\} \/>/);
assert.ok(
  pageSrc.indexOf("<PnlTrendChart") < pageSrc.indexOf("pnl-wide"),
  "chart above P&L table",
);
assert.match(chartSrc, /pos-ops-legend-btn/);
assert.match(chartSrc, /if \(!allowed\.some\(\(s\) => next\[s\.id\]\)\) return prev;/);
assert.match(chartSrc, /isOwner \|\| !s\.ownerOnly/);
assert.match(chartSrc, /has: hasVatData/);

/** Mirror pnlChartLinePath */
function linePath(pts) {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${d ? " " : ""}${pen ? "L" : "M"} ${p.x} ${p.y}`;
    pen = true;
  }
  return d;
}
assert.equal(
  linePath([null, { x: 1, y: 2 }, { x: 3, y: 4 }, null, { x: 5, y: 6 }]),
  "M 1 2 L 3 4 M 5 6",
);
assert.equal(linePath([null, null]), "");

/** Mirror pnlChartYAxis */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}
function yAxis(values, tickCount = 6) {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 1;
  const pad = (max - min) * 0.06;
  if (max > 0) max += pad;
  if (min < 0) min -= pad;
  const step = niceStep((max - min) / tickCount);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}
const ax = yAxis([442926.85, -25065]);
assert.ok(ax.lo <= -25065 && ax.hi >= 442926.85);
assert.ok(ax.ticks.includes(0), "zero tick");
assert.deepEqual(yAxis([]).ticks.length >= 2, true);

console.log("OK test-pnl-vat-auto-income");
