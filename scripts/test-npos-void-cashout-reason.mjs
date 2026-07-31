/**
 * Gate: void + cash-out reason fields are typable / required.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 548/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 159/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+127/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.104"/);

assert.ok(existsSync(join(root, "docs/npos-void-cashout-reason-checklist.md")));
assert.match(read("docs/npos-void-cashout-reason-checklist.md"), /1.14.104/);

const dlg = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/NposConfirmDialog.java");
assert.match(dlg, /containsEditText/);
assert.match(dlg, /focusFirstEditText/);
assert.match(dlg, /SOFT_INPUT_ADJUST_RESIZE/);
assert.match(dlg, /needsKeyboard/);
assert.match(dlg, /Scale breaks EditText|never scale|ไม่ scale|Do not use when/);

const receipts = read("npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java");
assert.match(receipts, /void_reason_required/);
assert.match(receipts, /void_reason_label/);
assert.match(receipts, /TYPE_TEXT_FLAG_MULTI_LINE/);

const shift = read("npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java");
assert.match(shift, /shift_cash_drop_reason_label/);
assert.match(shift, /shift_cash_drop_reason_required/);
assert.match(shift, /recordCashDrop\(this, amt, note\)/);

const prefs = read("npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java");
assert.match(prefs, /KEY_CASH_DROP_NOTES|cashDropNotes/);
assert.match(prefs, /recordCashDrop\(Context context, double amount, String reason\)/);
assert.match(prefs, /cashDropNotesSummary/);
assert.match(prefs, /cashDropNotesJson/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /confirmCancelPending/);
assert.match(sell, /cancelPending\(\s*this,\s*mutationId,\s*r/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /cashDropNotes/);
assert.match(sync, /cancelPending\(Context context, String mutationId, String reason/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /void_reason_required/);
assert.match(strings, /shift_cash_drop_reason_required/);

assert.match(read("scripts/check-npos-shop.mjs"), /void-cashout-reason/);
assert.match(read("docs/npos-remaining-checklist.md"), /npos-void-cashout-reason-checklist/);

console.log("OK test-npos-void-cashout-reason");
