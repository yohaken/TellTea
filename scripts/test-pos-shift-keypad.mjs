import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const keypadSrc = readFileSync(join(root, "src/components/PosCashKeypad.tsx"), "utf8");
assert.match(keypadSrc, /DIGITS = \["7", "8", "9", "4", "5", "6", "1", "2", "3"\]/);
assert.doesNotMatch(keypadSrc, /DIGITS = \["1", "2", "3"/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /pos-pay-sheet:has\(\.pos-cash-keypad\)/);
assert.match(css, /\.pos-pay-sheet-body\s*\{[\s\S]*?flex:\s*1\s+1\s+auto/);
assert.match(css, /\.pos-pay-actions\s*\{[\s\S]*?flex-shrink:\s*0/);
assert.match(css, /pos-shift-sticky-actions/);
assert.match(css, /pos-shift-history-sticky/);
assert.match(css, /pos-shift-session-print-btn/);

const shiftSrc = readFileSync(join(root, "src/components/PosShiftView.tsx"), "utf8");
assert.match(shiftSrc, /พิมพ์สรุปกลางรอบ/);
assert.match(shiftSrc, /พิมพ์สรุปช่วงนี้/);
assert.match(shiftSrc, /พิมพ์สรุปกะนี้/);
assert.match(shiftSrc, /pos-shift-sticky-actions/);
assert.match(shiftSrc, /buildShiftReportHtml/);
assert.match(shiftSrc, /kind: "close"/);

const templateSrc = readFileSync(join(root, "src/lib/pos-printer/shift-snapshot-template.ts"), "utf8");
assert.match(templateSrc, /Snapshot ระหว่างรอบการขาย/);
assert.match(templateSrc, /รายงานยอดการขาย/);
assert.match(templateSrc, /ไม่ใช่การปิดรอบ/);
assert.match(templateSrc, /ยอดขายตามหมวดหมู่/);
assert.match(templateSrc, /รายการขายแยกตามบิล/);
assert.match(templateSrc, /openShiftReportPrint/);

const reportSrc = readFileSync(join(root, "src/lib/pos-shift-report.ts"), "utf8");
assert.match(reportSrc, /buildShiftReportPayload/);
assert.match(reportSrc, /buildShiftReportDetail/);

const versionSrc = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(versionSrc, /POS_BUILD = \d+/);

const itemEditor = readFileSync(join(root, "src/components/PosMenuItemEditor.tsx"), "utf8");
assert.match(itemEditor, /updateMenuItem\(item\.id, \{ optionGroupIds: ids \}/);

const sellSrc = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sellSrc, /activeCategories[\s\S]*sortOrder/);

console.log("OK pos-shift-keypad-groups");
