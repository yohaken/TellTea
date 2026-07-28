/**
 * Gate: minimal hardware — paper 58/80, taxId on slip, No Sale drawer on sell.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 326/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+89/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.66"/);

assert.ok(existsSync(join(root, "docs/npos-hardware-minimal-checklist.md")));
assert.doesNotMatch(read("docs/npos-hardware-minimal-checklist.md"), /Kitchen|ครัว mapping|barcode/i);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterPrefs.java",
);
assert.match(prefs, /PAPER_58|paperWidthMm/);
assert.match(prefs, /receiptCols/);

const form = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(form, /taxId|เลขผู้เสียภาษี/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /PrinterPrefs\.receiptCols/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/printer/DrawerKick.java")),
);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /sell_hub_open_drawer|openDrawerNoSale/);
assert.match(sell, /DrawerKick\.send/);

const settingsXml = read("npos-telltea/app/src/main/res/layout/activity_settings.xml");
assert.match(settingsXml, /paperWidth80Button|paperWidth58Button/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /settings_section_printer">อุปกรณ์/);

const settings = read("src/lib/pos-settings.ts");
assert.match(settings, /taxId/);

const biz = read("src/components/PosBusinessSettingsView.tsx");
assert.match(biz, /เลขผู้เสียภาษี|taxId/);

const text = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(text, /เลขผู้เสียภาษี/);

console.log("OK test-npos-hardware-minimal");
