/**
 * Gate: transfer confirm-only, cart draft code, BO duration + open-first live totals.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 524/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 144/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+113/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.90"/);

assert.ok(existsSync(join(root, "docs/npos-transfer-cart-bo-checklist.md")));

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /pay_transfer_confirm">ตรวจสอบสลิปแล้ว OK/);
assert.match(strings, /pay_transfer_msg">[\s\S]*ตรวจสอบสลิปแล้ว OK/);
assert.match(strings, /cart_title_with_code">ตะกร้า · #%1\$s/);
assert.doesNotMatch(strings, /สแกน QR ป้าย \/ เลขบัญชี/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showTransferConfirm/);
assert.match(sell, /NposConfirmDialog\.confirm/);
assert.match(sell, /draftCartCode/);
assert.match(sell, /ensureDraftCartCode/);
assert.match(sell, /cart_title_with_code/);
assert.doesNotMatch(sell, /pay_transfer_ref_hint/);
assert.doesNotMatch(sell, /showTransferConfirm[\s\S]*NposUi\.field/);
assert.doesNotMatch(sell, /showTransferConfirm[\s\S]*EditText ref/);

const lib = read("src/lib/pos-sales-report.ts");
assert.match(lib, /export function sortSessionsOpenFirst/);
assert.match(lib, /export function sortSessionsByDateNewestFirst/);
assert.match(lib, /formatPosSessionDuration/);
assert.match(lib, /posSessionDurationMs/);
assert.match(lib, /sortSessionsByDateNewestFirst\(\[\.\.\.map\.values\(\)\]\)/);
assert.match(lib, /rowLimit = 120/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /durationLabel/);
assert.match(slim, />\s*รวม\s*</);
assert.match(slim, /npos-slim-duration/);
assert.match(slim, /วันใหม่→เก่า|active/);
assert.match(slim, /ยอดจากบิล realtime/);

const css = read("src/app/globals.css");
assert.match(css, /npos-slim-duration/);

console.log("OK test-npos-transfer-cart-bo");
