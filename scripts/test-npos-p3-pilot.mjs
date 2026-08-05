/**
 * nPos P3 / 1.10.0 — LAN, hold bill, outbox badge, shift strip, pilot docs.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 581);
assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterEndpoint.java"), /NETWORK/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterTransport.java"), /sendTcp/);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/HoldCart.java")));

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /holdBill/);
assert.match(sell, /updatePendingBadge/);
assert.match(sell, /updateShiftSummary/);

assert.match(read("npos-telltea/app/src/main/res/layout/activity_settings.xml"), /printerLanAddButton/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /holdBillButton/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /shiftSummary/);

assert.ok(existsSync(join(root, "docs/npos-pilot-roadmap.md")));
assert.ok(existsSync(join(root, "docs/npos-pilot-day-checklist.md")));
assert.match(read("docs/npos-parity-checklist.md"), /P3 — ทำแล้ว/);

console.log("OK test-npos-p3-pilot");
