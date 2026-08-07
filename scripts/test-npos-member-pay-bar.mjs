/**
 * Guard: สมาชิก beside pay CTA; smaller claim QR + bold invite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /cartPayBar/);
const payBar = layout.slice(layout.indexOf("cartPayBar"));
assert.match(payBar, /memberButton/);
assert.match(payBar, /holdBillButton/);
assert.ok(payBar.indexOf("memberButton") < payBar.indexOf("holdBillButton"));

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /applyPayBarWeights/);

const sunmi = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java");
assert.match(sunmi, /QrBitmaps\.encode\(url, 168\)/);

const form = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java");
assert.match(form, /BOLD_ON[\s\S]*CLAIM_QR_INVITE/);

const html = read("src/lib/pos-printer/receipt-template.ts");
assert.match(html, /88 : 100/);
assert.match(html, /font-weight: 800/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 141);

console.log("OK test-npos-member-pay-bar");
