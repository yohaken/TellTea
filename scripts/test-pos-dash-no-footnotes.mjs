/**
 * POS dashboard: no explanatory footnotes in the UI — definitions live in code comments.
 * Run: node scripts/test-pos-dash-no-footnotes.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "src/components/PosSalesDashboard.tsx",
  "src/components/PosSalesDashboardCharts.tsx",
  "src/components/PosSalesDashboardMembers.tsx",
  "src/components/PosSalesDashboardOptions.tsx",
  "src/components/PosSalesDashboardProductHours.tsx",
  "src/components/PosSalesDashboardProducts.tsx",
  "src/components/PosSalesDashboardStock.tsx",
  "src/components/PosSalesDashboardTimeTotals.tsx",
  "src/components/PosSalesDashboardWeekdays.tsx",
  "src/components/PosOpsCorrelationChart.tsx",
];

/** Strip comments so definitions kept for AI don't count as UI text. */
function uiOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const banned = [
  /pos-dash-footnote/,
  /pos-dash-day-weather-note/,
  /pos-ops-corr-note/,
  /เฉลี่ย\/วัน = /,
  /% = เทียบค่าเฉลี่ย/,
  /แตะแถวดูวันที่และวิธีคิด/,
  /×ครั้ง = /,
  /แกน Y = /,
  /ไม่ใช่ยอดขายบวกแต้ม/,
  /ตามเวลาขาย \(ปิดบิล\)/,
  /เขียว = วันขายดีสุด/,
  /คำนวณจากประวัติสต็อก/,
  /ไม่ใช่ต่อลูกค้า/,
  /ยอดสุทธิ ÷ จำนวนชิ้น/,
  /รวมส่วนลดที่หักจากยอดขาย/,
];

for (const f of files) {
  const ui = uiOnly(readFileSync(f, "utf8"));
  for (const re of banned) assert.doesNotMatch(ui, re, `${f}: ${re}`);
}

// Definitions still documented for AI / devs.
const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
assert.match(dash, /\* - ยอดรับเงินจริง = หลังหักส่วนลดมือ/);
const wd = readFileSync("src/components/PosSalesDashboardWeekdays.tsx", "utf8");
assert.match(wd, /\* - เฉลี่ย\/วัน = ยอดรวมของวันนั้น ÷ จำนวนวันนั้น/);
const opt = readFileSync("src/components/PosSalesDashboardOptions.tsx", "utf8");
assert.match(opt, /\* - ×ครั้ง = จำนวนที่ถูกเลือก/);

// State messages (not explanations) stay.
assert.match(readFileSync("src/components/PosSalesDashboardCharts.tsx", "utf8"), /ยังไม่จบวัน/);
assert.match(readFileSync("src/components/PosSalesDashboardProductHours.tsx", "utf8"), /ไม่มียอดในช่วงวันที่นี้/);

console.log("test-pos-dash-no-footnotes: ok");
