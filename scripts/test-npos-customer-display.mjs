/**
 * nPos dual-screen customer display — two-pane + auto-resize + 4 modes.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 245/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+36/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.13"/);
assert.match(read("docs/npos-customer-display-checklist.md"), /Auto-resize|สองพาเนล|65%/);

assert.ok(
  existsSync(
    join(
      root,
      "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayMetrics.java",
    ),
  ),
);
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
assert.match(layout, /paneMedia/);
assert.match(layout, /paneReceipt/);
assert.match(layout, /mediaPayOverlay/);
assert.match(layout, /receiptLines/);
assert.match(layout, /panelSuccess/);
assert.match(layout, /payQr/);
assert.match(layout, /successCheck/);

const metrics = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayMetrics.java",
);
assert.match(metrics, /mediaWeight/);
assert.match(metrics, /landscape/);
assert.match(metrics, /qrEdgePx/);
assert.match(metrics, /720/);

const ctrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayController.java",
);
assert.match(ctrl, /showStandby/);
assert.match(ctrl, /showSelecting/);
assert.match(ctrl, /showPaymentCash/);
assert.match(ctrl, /showPaymentQr/);
assert.match(ctrl, /showSuccessThenStandby/);
assert.match(ctrl, /updatePromo|applyIdleOrPromoFrame/);
assert.match(ctrl, /PROMO_ROTATE_MS\s*=\s*5000/);

const present = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayPresentation.java",
);
assert.match(present, /applyMetricsLayout/);
assert.match(present, /HORIZONTAL|VERTICAL/);
assert.match(present, /unitPrice/);
assert.match(present, /customer_success_paid|showSuccess/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /CustomerDisplayController/);
assert.match(sell, /unitPrice/);
assert.match(sell, /changeForCustomer/);
assert.match(sell, /showSuccessThenStandby/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /customer_success_paid/);
assert.match(strings, /customer_success_change_fmt/);
assert.match(strings, /customer_receipt_subtotal_fmt/);

assert.match(read("docs/npos-remaining-checklist.md"), /1\.14\.|สองพาเนล|W1|auto-resize|จอลูกค้า/);

console.log("OK test-npos-customer-display");
