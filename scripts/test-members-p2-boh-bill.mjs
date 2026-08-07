/**
 * Guard: members P2 — BOH bill paper shows member / redeem / points earned.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const boh = read("src/lib/pos-boh-print-docs.ts");
assert.match(boh, /manualDiscountBaht/);
assert.match(boh, /redeemBaht/);
assert.match(boh, /pointsEarned/);
assert.match(boh, /memberPhone/);

const local = read("src/lib/pos-local-receipts.ts");
assert.match(local, /manualDiscountBaht\?:/);
assert.match(local, /pointsRedeemed\?:/);

const payload = read("src/lib/pos-printer/types.ts");
assert.match(payload, /redeemBaht\?:/);
assert.match(payload, /pointsEarned\?:/);

const view = read("src/lib/pos-receipt-view.ts");
assert.match(view, /pointsRedeemed/);

const html = read("src/lib/pos-printer/receipt-template.ts");
assert.match(html, /receiptDiscountRowsHtml/);
assert.match(html, /แลกแต้ม/);
assert.match(html, /แต้มที่ได้/);
assert.match(html, /สแกนสะสมแต้ม/);

const text = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(text, /แลกแต้ม/);
assert.match(text, /แต้มที่ได้/);
assert.match(text, /CLAIM_QR_MARKER/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /แลกแต้ม/);
assert.match(report, /sale\.memberId/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 745);

console.log("OK test-members-p2-boh-bill");
