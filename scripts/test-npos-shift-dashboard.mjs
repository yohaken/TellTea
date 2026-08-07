/**
 * nPos shift panel: 30/70 dashboard cards + local session history.
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
assert.ok(existsSync(join(root, "docs/npos-shift-dashboard-checklist.md")));

const shift = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java",
);
assert.match(shift, /weight,\s*30f|30f\)/);
assert.match(shift, /weight,\s*70f|70f\)/);
assert.match(shift, /shift_card_cash_title/);
assert.match(shift, /shift_card_transfer_title/);
assert.match(shift, /shift_card_summary_title/);
assert.match(shift, /shift_staff_line/);
assert.match(shift, /SessionHistory/);
assert.match(shift, /TAB_HISTORY|shift_nav_history/);
assert.match(shift, /askCashDrop/);
assert.match(shift, /BlindCloseFlow/);

const hist = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/SessionHistory.java",
);
assert.match(hist, /rememberClose/);
assert.match(hist, /listNewestFirst/);

const sync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(sync, /SessionHistory\.rememberClose/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /shift_nav_dashboard/);
assert.match(strings, /shift_history_empty/);
assert.match(strings, /shift_staff_line/);

console.log("OK test-npos-shift-dashboard");
