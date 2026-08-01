/**
 * Gate: cash pay — drawer before paper, Sunmi one-shot, sync off sale thread.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-cash-pay-fast-phases.md")));
assert.match(read("docs/npos-cash-pay-fast-phases.md"), /C1|C2|C3|C4/);
assert.match(read("docs/npos-cash-pay-fast-phases.md"), /1\.14\.107/);

assert.match(read("src/lib/version.ts"), /APP_BUILD = 581/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 166/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+130/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 130/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /syncExecutor/);
assert.match(saleSync, /queue drawer BEFORE paper|BEFORE paper/i);
assert.match(
  saleSync,
  /if \(kickDrawer && CashDrawerPolicy\.shouldKickAfterSale\(paymentMethod\)\)[\s\S]*?drawerKick\(\)[\s\S]*?documentReceipt/,
);
assert.match(
  saleSync,
  /syncExecutor\.execute\([\s\S]*?flushOne\(app, payload/,
);
assert.doesNotMatch(
  saleSync,
  /result\.ok\)[\s\S]{0,120}drawerKick/,
);

const sunmi = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(sunmi, /Always one-shot|one-shot/);
assert.match(sunmi, /printTextOnce\(svc, EscPos\.stripBoldMarkers\(body\)\)/);
// Bold chunk helper may remain, but printPlain must not call it.
assert.doesNotMatch(
  sunmi,
  /printPlain[\s\S]*?printTextBoldSegments\(svc/,
);

const policy = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/CashDrawerPolicy.java",
);
assert.match(policy, /before the receipt/);
assert.match(policy, /shouldKickAfterSale/);

const drawerDoc = read("docs/npos-doc-drawer-polish-checklist.md");
assert.match(drawerDoc, /1\.14\.107|ก่อนกระดาษ|ก่อนพิมพ์/);

console.log("OK test-npos-cash-pay-fast");
