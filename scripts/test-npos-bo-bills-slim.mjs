/**
 * Gate: BO bills collapsed superslim + trial force-close column.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 356/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 123/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+94/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.71"/);

assert.ok(existsSync(join(root, "docs/npos-bo-bills-slim-checklist.md")));

const lib = read("src/lib/pos-sales-report.ts");
assert.match(lib, /POS_BILLS_SLIM_PAGE\s*=\s*25/);

const admin = read("src/lib/pos-sales-admin.ts");
assert.match(admin, /export async function closePosSessionAdmin/);
assert.match(admin, /closeSource:\s*"bo-force"/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /onForceClose/);
assert.match(slim, /ปิดรอบ/);
assert.match(slim, /npos-slim-col-session/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /pos-sales-bills-fold/);
assert.match(report, /npos-slim-row--bills-super/);
assert.match(report, /billsVisible/);
assert.match(report, /onBillsScroll/);
assert.match(report, /closePosSessionAdmin/);
assert.match(report, /PosReceiptPaper/);

const css = read("src/app/globals.css");
assert.match(css, /npos-slim-row--bills-super/);
assert.match(css, /npos-bills-slim-scroll/);
assert.match(css, /npos-slim-col-session/);

console.log("OK test-npos-bo-bills-slim");
