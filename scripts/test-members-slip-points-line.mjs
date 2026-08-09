/**
 * Guard: slip shows bill points near totals (modern-trade), not under QR.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const form = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(form, /แต้มบิลนี้/);
assert.match(form, /claimPointsPreview/);
assert.match(form, /แต้มที่ได้/);
// Points line before QR block (use center call, not the constant declaration)
const earnedIdx = form.indexOf('leftRight("แต้มที่ได้"');
const previewIdx = form.indexOf('leftRight("แต้มบิลนี้"');
const qrIdx = form.indexOf("center(CLAIM_QR_INVITE");
assert.ok(earnedIdx > 0 && previewIdx > 0 && qrIdx > 0);
assert.ok(previewIdx < qrIdx, "แต้มบิลนี้ must sit above QR");

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /claimPointsPreview/);
assert.match(saleSync, /optInt\("claimPointsPreview"/);

const cf = read("functions/pos-members.js");
assert.match(cf, /claimPointsPreview/);
assert.match(cf, /claimPointsPreview,/);

const html = read("src/lib/pos-printer/receipt-template.ts");
assert.match(html, /แต้มบิลนี้/);
assert.match(html, /claimPointsPreview/);
const text = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(text, /แต้มบิลนี้/);

const boh = read("src/lib/pos-boh-print-docs.ts");
assert.match(boh, /claimPointsPreview/);
const view = read("src/lib/pos-receipt-view.ts");
assert.match(view, /claimPointsPreview/);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 762);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 200);
assert.ok(
  Number(read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/)[1]) >= 147,
);

console.log("OK test-members-slip-points-line");
