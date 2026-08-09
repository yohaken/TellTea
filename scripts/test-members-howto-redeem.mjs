/**
 * Guard: customer how-to-use-points on /claim, /me, and receipt/slip.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const note = read("src/components/ClaimPointsValueNote.tsx");
assert.match(note, /1 แต้ม = ส่วนลด 1 บาท/);
assert.match(note, /สแกน QR รับแต้มจากบิล/);
assert.match(note, /ครั้งหน้าบอกเบอร์ตอนจ่าย/);
assert.match(note, /ใช้แต้มลดยอดได้เลย/);

const claim = read("src/app/claim/page.tsx");
assert.match(claim, /ClaimPointsValueNote/);
const me = read("src/app/me/page.tsx");
assert.match(me, /ClaimPointsValueNote/);

const html = read("src/lib/pos-printer/receipt-template.ts");
assert.match(html, /claim-qr-hint/);
assert.match(html, /1แต้ม=ลด1฿ · ครั้งหน้าบอกเบอร์/);

const text = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(text, /1แต้ม=ลด1฿ · ครั้งหน้าบอกเบอร์/);

const form = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(form, /CLAIM_QR_HINT/);
assert.match(form, /1แต้ม=ลด1฿ · ครั้งหน้าบอกเบอร์/);
assert.match(form, /center\(CLAIM_QR_HINT/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 762);
const pos = read("src/lib/pos-version.ts");
assert.ok(Number(pos.match(/POS_BUILD = (\d+)/)[1]) >= 200);
const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 147);

console.log("OK test-members-howto-redeem");
