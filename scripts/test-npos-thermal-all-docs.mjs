/**
 * Gate: every thermal paper doc is TIS-safe + X/Z never mistaken for sale receipt.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 407/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 132/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+103/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.80"/);

assert.ok(existsSync(join(root, "docs/npos-thermal-all-docs-checklist.md")));
assert.match(read("docs/npos-thermal-all-docs-checklist.md"), /ThermalSafe|ไม่ใช่ใบเสร็จ/);

const safe = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ThermalSafe.java",
);
assert.match(safe, /public static String ascii/);
assert.match(safe, /0x00D7/);
assert.match(safe, /0x2022/);
assert.match(safe, /0x2014/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /ThermalSafe\.ascii/);
assert.match(esc, /documentReceipt/);

const receipt = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(receipt, /BOLD_ON/);
assert.match(receipt, /ยอดสุทธิ/);
// Sale receipt must NOT embed shift summary frames.
assert.doesNotMatch(receipt, /ยอดขายตามหมวดหมู่|ยอดขายตามรายการ|รายงานสรุปรอบ/);

const shift = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(shift, /รายงานสรุปรอบ/);
assert.match(shift, /ไม่ใช่ใบเสร็จ/);
assert.match(shift, /ยอดขายตามหมวดหมู่/);
assert.match(shift, /BOLD_ON/);

// Sale print path builds customer form only (shift report is a separate entrypoint).
const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /private void maybePrintAndKick/);
assert.match(saleSync, /ReceiptFormBuilder\.build/);
assert.match(saleSync, /printShiftReport/);
const kickFn = saleSync.slice(saleSync.indexOf("private void maybePrintAndKick"));
const kickBody = kickFn.slice(0, kickFn.indexOf("\n    private ") > 0 ? kickFn.indexOf("\n    private ") : 2500);
assert.match(kickBody, /ReceiptFormBuilder\.build/);
assert.doesNotMatch(kickBody, /ShiftReportFormBuilder/);

// Scan paper form builders + EscPos test page — not UI/log strings in transport helpers.
const paperFiles = [
  "ReceiptFormBuilder.java",
  "ShiftReportFormBuilder.java",
  "EscPos.java",
];
const printerDir = join(root, "npos-telltea/app/src/main/java/app/telltea/npos/printer");
const risky = /[×•…—–−·“”‘’✓★→←]/;
const bad = [];
for (const name of paperFiles) {
  const src = readFileSync(join(printerDir, name), "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();
    if (trim.startsWith("//") || trim.startsWith("*") || trim.startsWith("/*")) continue;
    const parts = line.split('"');
    for (let j = 1; j < parts.length; j += 2) {
      if (risky.test(parts[j])) {
        bad.push(`${name}:${i + 1}: "${parts[j]}"`);
      }
    }
  }
}
assert.equal(bad.length, 0, `TIS-risk glyphs in paper strings:\n${bad.join("\n")}`);
// sanity: directory still has builders
assert.ok(readdirSync(printerDir).includes("ThermalSafe.java"));

assert.match(read("scripts/check-npos-shop.mjs"), /thermal-all-docs/);
assert.match(read("docs/npos-remaining-checklist.md"), /npos-thermal-all-docs-checklist/);

console.log("OK test-npos-thermal-all-docs");
