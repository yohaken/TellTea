/**
 * nPos blind shift close (Wongnai-style) — count first, then reveal over/short.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 673);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 177);
assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);
assert.match(read("docs/npos-blind-shift-close-checklist.md"), /Blind|Over|Short|B1/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java")),
);
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseReport.java"),
  ),
);

const flow = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java",
);
assert.match(flow, /askCountedCash|blind_close_count/);
assert.match(flow, /revealSummary|discrepancyLabel/);
assert.match(flow, /leaveFloat/);
assert.match(flow, /flushThenCloseSession/);
assert.match(flow, /NposNumberPad/);
assert.match(flow, /hasUnsyncedWork|blind_close_sync_required/);
assert.doesNotMatch(flow, /listPending/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(prefs, /openingCash|nextOpeningCash|KEY_OPENING_CASH/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /BlindCloseReport/);
assert.match(sync, /closingCashCounted|cashDifference|leaveFloat/);
assert.match(sync, /flushThenCloseSession|flushPendingBlocking/);
// Hard gate: Z-close blocked while sale outbox or void queue remains.
assert.match(sync, /hasUnsyncedWork/);
assert.match(sync, /ปิดรอบถูกบล็อก — ยังมีบิล\/ทำลายค้างซิงก์/);
const closeIdx = sync.indexOf("public void flushThenCloseSession(");
assert.ok(closeIdx > 0);
const closeChunk = sync.slice(closeIdx, closeIdx + 2200);
assert.match(closeChunk, /hasUnsyncedWork\(app\)/);
assert.match(closeChunk, /postCloseSession/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /blind_close_sync_required/);
assert.match(strings, /ต้องต่อเน็ตและซิงก์/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /closingCashCounted/);
assert.match(cf, /cashDifference/);
assert.match(cf, /discrepancyNote/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /BlindCloseFlow/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"), /BlindCloseFlow/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java"), /BlindCloseFlow/);

assert.match(read("docs/npos-remaining-checklist.md"), /B1–B4|1.14/);

console.log("OK test-npos-blind-shift-close");
