/**
 * Gate: thermal-safe receipt item lines (ASCII x/-, spacing, bold markers).
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

assert.ok(existsSync(join(root, "docs/npos-receipt-readable-checklist.md")));
assert.match(read("docs/npos-receipt-readable-checklist.md"), /1.14.104/);
assert.match(read("docs/npos-receipt-readable-checklist.md"), /\?2|TIS-620|x2/);

const java = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(java, /BOLD_ON/);
assert.match(java, /qtyCol/);
assert.match(java, /" x"/);
assert.match(java, /"    "/); // option indent under name
assert.match(java, /qtyEmphasized\(mod\.count\)/);
assert.match(java, /blank line between drinks|firstItem/);
assert.doesNotMatch(java, /"×"|"•"|'×'|'•'/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /BOLD_ON/);
assert.match(esc, /appendTextWithBold/);
assert.match(esc, /0x45/); // ESC E

const sunmi = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(sunmi, /0x45/);
assert.match(sunmi, /printTextBoldSegments/);
assert.match(sunmi, /BOLD_ON/); // ESC E → markers, not stripped

const textForm = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(textForm, /qtyCol/);
assert.match(textForm, /\$\{qtyCol\} \$\{title\}/);
assert.match(textForm, /formatReceiptModifierText/);
assert.match(textForm, / {4}\$\{label\}|` {4}\$\{label\}/);
assert.match(textForm, /blank line between drinks/);
assert.doesNotMatch(textForm, /×|•/);

const tpl = read("src/lib/pos-printer/receipt-template.ts");
assert.match(tpl, /mod-qty--hot/);
assert.match(tpl, /qty-badge--hot/);
assert.match(tpl, /x\$\{count\}/);

assert.match(read("scripts/check-npos-shop.mjs"), /receipt-readable/);
assert.match(read("docs/npos-remaining-checklist.md"), /npos-receipt-readable-checklist/);

console.log("OK test-npos-receipt-readable");
