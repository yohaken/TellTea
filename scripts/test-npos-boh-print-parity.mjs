/**
 * Gate: BOH bill/session docs use the same builders as thermal paper.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 669);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 175);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+132/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.109"/);

const boh = read("src/lib/pos-boh-print-docs.ts");
assert.match(boh, /buildUnifiedReceiptBody/);
assert.match(boh, /buildShiftReportHtml/);
assert.match(boh, /buildBohSessionReportPreviewHtml/);
assert.match(boh, /saleToLocalReceipt/);

const paper = read("src/components/PosReceiptPaper.tsx");
assert.match(paper, /buildUnifiedReceiptBody/);
assert.match(paper, /PosPrintDocFrame/);
assert.match(paper, /localReceiptToPrintPayload/);

const sessionDocs = read("src/components/PosSessionPrintDocs.tsx");
assert.match(sessionDocs, /X · ระหว่างกะ/);
assert.match(sessionDocs, /ใบส่งเงินสด/);
assert.match(sessionDocs, /buildBohSessionReportPreviewHtml/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /PosSessionPrintDocs/);
assert.match(report, /subscribePosShopSettings/);

const shiftTpl = read("src/lib/pos-printer/shift-snapshot-template.ts");
assert.match(shiftTpl, /ยอดเงินสดที่ต้องนำส่ง/);
assert.match(shiftTpl, /discrepancyNote/);
assert.match(shiftTpl, /shiftLabel/);
assert.match(shiftTpl, /สรุปบิล \(สถิติ\)/);
assert.doesNotMatch(shiftTpl, /รายการขายแยกตามบิล/);

const javaShift = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(javaShift, /สรุปบิล \(สถิติ\)/);
assert.doesNotMatch(javaShift, /รายการขายแยกตามบิล/);
assert.doesNotMatch(javaShift, /billBlocks/);
// Native sale lines store "price"; X/Z must not read unitPrice alone (was printing ยอด=0).
assert.match(javaShift, /lineUnitPrice/);
assert.match(javaShift, /optDouble\("price"/);
assert.match(javaShift, /optDouble\("unitPrice"/);

const payload = read("src/lib/pos-shift-report.ts");
assert.match(payload, /discrepancyNote/);
assert.match(payload, /shiftLabel/);
assert.match(payload, /staffName/);

const receiptPay = read("src/lib/pos-printer/receipt-template.ts");
assert.match(receiptPay, /โอนเงิน/);

console.log("OK test-npos-boh-print-parity");
