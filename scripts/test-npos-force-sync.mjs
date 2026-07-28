/**
 * Gate: mandatory update (no Later snooze) + Bangkok day sync for sessions.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

assert.match(read("src/lib/version.ts"), /APP_BUILD = 327/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+89/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.66"/);

assert.ok(existsSync(join(root, "docs/npos-force-sync-checklist.md")));

const prompt = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java",
);
assert.match(prompt, /laterBtn\.setVisibility\(View\.GONE\)/);
assert.match(prompt, /clearPopupDismiss/);
assert.doesNotMatch(prompt, /dismissPopupFor\(activity,\s*UpdateConfig\.POPUP_SNOOZE_MS\)/);

const coord = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateCheckCoordinator.java",
);
assert.match(coord, /reassertPendingUpdate/);

const day = require(join(root, "functions/bangkok-day.js"));
const now = Date.now();
const cfDay = day.startOfBangkokDay(now);
assert.equal(typeof cfDay, "number");
assert.ok(Number.isFinite(cfDay));

// BO helper must match CF
const utils = read("src/lib/utils.ts");
assert.match(utils, /Asia\/Bangkok/);
assert.match(utils, /7 \* 60 \* 60 \* 1000/);

const sell = read("functions/npos-sell.js");
assert.match(sell, /require\("\.\/bangkok-day"\)/);
assert.match(sell, /date: correctDate|dateRepaired|correctDate/);

const complete = read("functions/pos-complete-sale.js");
assert.match(complete, /require\("\.\/bangkok-day"\)/);

const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /dateRepairedAt|startOfBangkokDay/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /ensureOpenSessionSynced/);
assert.match(sync, /markServerSessionSynced/);

const prefs = read("npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java");
assert.match(prefs, /KEY_SERVER_SYNCED|isServerSessionSynced/);

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /status", "==", "open"|status\",\s*\"==\",\s*\"open\"/);
assert.match(report, /legacyUtcDate/);

const fg = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java",
);
assert.match(fg, /flushPending|ensureOpenSessionSynced/);

console.log("ok: npos-force-sync gate", { cfDay });
