/**
 * nPos dual-screen customer display — 4 modes.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 230/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+23/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.0"/);
assert.match(read("docs/npos-customer-display-checklist.md"), /สแตนด์บาย|เลือกรายการ|ชำระเงิน|สำเร็จ/);

assert.ok(
  existsSync(
    join(
      root,
      "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayController.java",
    ),
  ),
);
assert.ok(
  existsSync(
    join(
      root,
      "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayPresentation.java",
    ),
  ),
);

const layout = read("npos-telltea/app/src/main/res/layout/presentation_customer.xml");
assert.match(layout, /panelStandby/);
assert.match(layout, /panelSelecting/);
assert.match(layout, /panelPayment/);
assert.match(layout, /panelSuccess/);
assert.match(layout, /payQr/);
assert.match(layout, /selectLines/);

const ctrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayController.java",
);
assert.match(ctrl, /showStandby/);
assert.match(ctrl, /showSelecting/);
assert.match(ctrl, /showPaymentCash/);
assert.match(ctrl, /showPaymentQr/);
assert.match(ctrl, /showSuccessThenStandby/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /CustomerDisplayController/);
assert.match(sell, /syncCustomerDisplay/);
assert.match(sell, /showPaymentCash/);
assert.match(sell, /showPaymentQr/);
assert.match(sell, /showSuccessThenStandby/);
assert.match(sell, /renderCartViewsOnly/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /customer_standby_welcome/);
assert.match(strings, /customer_select_title/);
assert.match(strings, /customer_pay_qr_hint/);
assert.match(strings, /customer_success_title/);

assert.match(read("docs/npos-remaining-checklist.md"), /1\.14\.0|จอลูกค้า 4 โหมด/);

console.log("OK test-npos-customer-display");
