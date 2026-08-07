/**
 * Guard: BOH /pos-sales bill preview matches nPos slip (claimToken map + member line + QR).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /claimToken/);
assert.match(report, /memberName/);
assert.match(report, /memberPhoneDisplay/);

const boh = read("src/lib/pos-boh-print-docs.ts");
assert.match(boh, /memberName/);
assert.match(boh, /memberPhone/);
assert.match(boh, /buildClaimUrl/);
assert.doesNotMatch(boh, /customerPhone \|\| memberPhone/);

const html = read("src/lib/pos-printer/receipt-template.ts");
assert.match(html, /สมาชิก:/);
assert.match(html, /class="member"/);
assert.match(html, /สแกนสะสมแต้ม/);
assert.match(html, /showTender/);

const text = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(text, /สมาชิก:/);

const paper = read("src/components/PosReceiptPaper.tsx");
assert.match(paper, /claimQrDataUrl/);

const types = read("src/lib/types.ts");
assert.match(types, /memberName\?:/);
assert.match(types, /memberPhoneDisplay\?:/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 745);

console.log("OK test-members-boh-slip-parity");
