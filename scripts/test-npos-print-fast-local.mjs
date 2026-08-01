/**
 * Gate: print receipt immediately after local save (before HTTP sync).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-print-fast-local-phases.md")));
assert.match(read("docs/npos-print-fast-local-phases.md"), /P1|P2|P3/);
assert.match(read("docs/npos-print-fast-local-phases.md"), /1.14.107/);

assert.match(read("src/lib/version.ts"), /APP_BUILD = 581/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 166/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+130/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1.14.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 130/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /onLocalSaved/);
assert.match(saleSync, /Fast path: drawer|Fast path: paper/);
assert.match(
  saleSync,
  /if \(print && !isReceiptPrinted\(app, mutationId\)\)[\s\S]*?maybePrintAndKick[\s\S]*?provisionalBillNo\(mutationId\)[\s\S]*?flushOne/,
);
assert.match(saleSync, /syncExecutor/);
assert.match(saleSync, /markReceiptPrinted\(app, mutationId\)/);
assert.match(
  saleSync,
  /payload\.optBoolean\("receiptPrinted", false\)[\s\S]*?isReceiptPrinted[\s\S]*?return;/,
);
assert.match(saleSync, /updateReceiptBill/);

const checklist = read("docs/npos-receipt-parity-checklist.md");
assert.match(checklist, /1.14.107/);
assert.match(checklist, /ทันทีหลังบันทึกในเครื่อง/);
assert.match(checklist, /ไม่รอ HTTP/);

console.log("OK test-npos-print-fast-local");
