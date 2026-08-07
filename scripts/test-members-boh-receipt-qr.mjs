/**
 * Guard: BOH bill paper/preview shows claim QR (parity with nPos P5).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const boh = read("src/lib/pos-boh-print-docs.ts");
assert.match(boh, /buildClaimUrl/);
assert.match(boh, /claimToken/);
assert.match(boh, /claimUrl/);

const local = read("src/lib/pos-local-receipts.ts");
assert.match(local, /claimUrl\?:/);
assert.match(local, /claimQrDataUrl\?:/);

const types = read("src/lib/pos-printer/types.ts");
assert.match(types, /claimUrl\?:/);
assert.match(types, /claimQrDataUrl\?:/);

const view = read("src/lib/pos-receipt-view.ts");
assert.match(view, /claimUrl/);
assert.match(view, /claimQrDataUrl/);

const html = read("src/lib/pos-printer/receipt-template.ts");
assert.match(html, /claim-qr/);
assert.match(html, /สแกนสะสมแต้ม/);
assert.match(html, /claimQrDataUrl/);

const text = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(text, /CLAIM_QR_MARKER/);
assert.match(text, /สแกนสะสมแต้ม/);

const paper = read("src/components/PosReceiptPaper.tsx");
assert.match(paper, /claimQrDataUrl/);
assert.match(paper, /claimUrl/);

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /claimToken/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 745);

const posVer = read("src/lib/pos-version.ts");
assert.ok(Number(posVer.match(/POS_BUILD = (\d+)/)[1]) >= 193);

console.log("OK test-members-boh-receipt-qr");
