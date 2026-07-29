/**
 * VAT money display/input must always include thousands commas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVatMoney,
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
  pctFieldValue,
} from "../src/lib/vat-number-format";

assert.equal(formatVatMoney(12345.6), "12,345.60");
assert.equal(formatVatMoney(7), "7.00");
assert.equal(formatVatMoney(0), "0.00");

assert.equal(moneyFieldValue(12345.6), "12,345.60");
assert.equal(moneyFieldValue(0), "");
assert.equal(moneyFieldValue(1000), "1,000.00");

assert.equal(parseVatMoneyInput("12,345.67"), 12345.67);
assert.equal(parseVatMoneyInput("12345.67"), 12345.67);
assert.equal(normalizeMoneyFieldText("1234.5"), "1,234.50");
assert.equal(normalizeMoneyFieldText(""), "");

assert.equal(pctFieldValue(90), "90.00");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(join(root, "docs/vat-number-format.md"), "utf8");
assert.match(doc, /คอมม่าหลักพันเสมอ/);
assert.match(doc, /moneyFieldValue/);
assert.match(doc, /Checklist ตอนสร้าง/);

const workbench = readFileSync(
  join(root, "src/components/vat-sales/VatMonthlyWorkbench.tsx"),
  "utf8",
);
assert.match(workbench, /normalizeMoneyFieldText/);
assert.match(workbench, /parseVatMoneyInput/);
assert.doesNotMatch(workbench, /formatPlainNumber/);

console.log("OK test-vat-number-format");
