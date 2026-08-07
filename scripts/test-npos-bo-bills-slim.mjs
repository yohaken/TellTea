/**
 * Gate: BO bills collapsed superslim + trial force-close column.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 581);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 166);
assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);

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
