/**
 * Gate: O2 session cash detail — persist cashDropNotes + BO expand fields.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 532/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 148/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+117/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.94"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.94"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 117/);

assert.ok(existsSync(join(root, "docs/npos-session-cash-detail-checklist.md")));
const doc = read("docs/npos-session-cash-detail-checklist.md");
assert.match(doc, /1\.14\.94|cashDropNotes|นำส่ง/);
assert.match(doc, /O2\./);

const cf = read("functions/npos-sell.js");
assert.match(cf, /sanitizeCashDropNotes/);
assert.match(cf, /cashDropNotes/);
assert.match(cf, /remitAmount/);
assert.match(cf, /cashBillCount/);
assert.match(cf, /promptpayBillCount/);
assert.match(cf, /transferBillCount/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /cashDropNotes/);
assert.match(saleSync, /cashBillCount/);
assert.match(saleSync, /remitAmount/);

const types = read("src/lib/types.ts");
assert.match(types, /PosSessionCashDropNote/);
assert.match(types, /cashDropNotes\??:/);
assert.match(types, /remitAmount\??:/);

const map = read("src/lib/pos-sales-report.ts");
assert.match(map, /mapCashDropNotes|cashDropNotes/);
assert.match(map, /remitAmount/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /dropNotes|npos-slim-drop-notes/);
assert.match(slim, /นำส่ง|discrepancyLabel/);
assert.match(slim, /columnheader[^\n]*นับ|title=\"เงินสดที่นับ/);
assert.match(slim, /row\.counted|closingCashCounted/);
assert.match(slim, /นำส่ง/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-drop-notes/);

const phases = read("docs/npos-counter-ops-phases.md");
assert.match(phases, /O2/);
assert.match(phases, /1\.14\.94/);

assert.match(read("scripts/check-npos-shop.mjs"), /session-cash-detail/);

console.log("OK test-npos-session-cash-detail");
