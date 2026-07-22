/**
 * nPos blind shift close (Wongnai-style) — count first, then reveal over/short.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 241/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+34/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.11"/);
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
assert.match(flow, /leaveFloat|listPending/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(prefs, /openingCash|nextOpeningCash|KEY_OPENING_CASH/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /BlindCloseReport/);
assert.match(sync, /closingCashCounted|cashDifference|leaveFloat/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /closingCashCounted/);
assert.match(cf, /cashDifference/);
assert.match(cf, /discrepancyNote/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /BlindCloseFlow/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"), /BlindCloseFlow/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java"), /BlindCloseFlow/);

assert.match(read("docs/npos-remaining-checklist.md"), /B1–B4|1\.14\.11/);

console.log("OK test-npos-blind-shift-close");
