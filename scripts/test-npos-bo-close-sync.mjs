/**
 * Gate: BO force-close settles on tablet via heartbeat (not kick); no reopen closed.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 525/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 144/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+114/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.91"/);

assert.ok(existsSync(join(root, "docs/npos-bo-close-sync-checklist.md")));
assert.match(read("docs/npos-bo-close-sync-checklist.md"), /sessionRemoteClosed|heartbeat|ไม่.*seat/);

const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /sessionRemoteClosed/);
assert.match(hb, /sessionCloseSource/);
assert.match(hb, /clientSessionId|body\.sessionId/);

const sell = read("functions/npos-sell.js");
assert.match(sell, /session_remote_closed/);
assert.match(sell, /alreadyClosed/);
assert.match(sell, /zFinalizedAt/);
assert.match(sell, /asString\(prev\.status,\s*16\) === "closed"/);
assert.match(sell, /asString\(data\.status,\s*16\) === "closed"/);

const prefs = read("npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java");
assert.match(prefs, /applyRemoteSessionClosed/);
assert.match(prefs, /RemoteCloseListener/);
assert.match(prefs, /settleRemoteClosed/);

const deviceHb = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java",
);
assert.match(deviceHb, /sessionRemoteClosed/);
assert.match(deviceHb, /applyRemoteSessionClosed/);
assert.match(deviceHb, /body\.put\("sessionId"/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /isRemoteSessionClosed/);
assert.match(saleSync, /session_remote_closed/);

const app = read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java");
assert.match(app, /onRemoteSessionClosed/);
assert.match(app, /addRemoteCloseListener/);
assert.doesNotMatch(app, /onRemoteSessionClosed[\s\S]{0,400}EXTRA_SHOW_CLAIM_GATE/);

const sellAct = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sellAct, /onRemoteSessionClosedFromSync/);
assert.match(sellAct, /maybeSettleRemoteClosed/);
assert.match(sellAct, /shift_remote_closed_banner/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /heartbeat|จบบิลในตะกร้า/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /shift_remote_closed_title/);
assert.match(strings, /shift_remote_closed_msg/);

console.log("OK test-npos-bo-close-sync");
