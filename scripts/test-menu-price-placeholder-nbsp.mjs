/**
 * Chrome walk-test follow-ups:
 * - delivery placeholder is always «ส่ง» (not store price like 5.00)
 * - NBSP / odd spaces normalize for search + sanitize on save
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 265/);

const priceTable = read("src/components/PosMenuOptionPriceTable.tsx");
const groupEditor = read("src/components/PosOptionGroupEditor.tsx");
const admin = read("src/components/PosMenuAdmin.tsx");
const menuLib = read("src/lib/pos-menu.ts");
const optionsLib = read("src/lib/pos-menu-options.ts");
const textLib = read("src/lib/pos-menu-text.ts");

// —— Delivery placeholder: consistent «ส่ง», never store price as hint ——
assert.match(priceTable, /placeholder="ส่ง"/);
assert.match(groupEditor, /placeholder="ส่ง"/);
assert.doesNotMatch(priceTable, /placeholder=\{[^}]*priceDelta/);
assert.doesNotMatch(priceTable, /placeholder=\{String\(r\.choice\.priceDelta/);
assert.match(priceTable, /menuTextIncludes/);
assert.match(priceTable, /placeholder «ส่ง»/);

// —— Search uses NBSP-safe matcher ——
assert.match(admin, /menuTextIncludes/);
assert.match(textLib, /normalizeMenuSearchText/);
assert.match(textLib, /sanitizeMenuLabel/);
assert.match(textLib, /\\u00a0/);

// —— Persist sanitized labels ——
assert.match(optionsLib, /sanitizeMenuLabel\(name\)/);
assert.match(optionsLib, /sanitizeMenuLabel\(o\.name\)/);
assert.match(optionsLib, /sanitizeMenuLabel\(data\.name\)/);
assert.match(menuLib, /sanitizeMenuLabel\(name\)/);
assert.match(menuLib, /sanitizeMenuLabel\(input\.name\)/);
assert.match(menuLib, /sanitizeMenuLabel\(patch\.name\)/);

// —— Runtime mirror of pos-menu-text helpers (keep in sync with source) ——
const ODD_SPACE = /[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g;
function normalizeMenuSearchText(value) {
  return value
    .normalize("NFC")
    .replace(ODD_SPACE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function menuTextIncludes(haystack, needle) {
  const n = normalizeMenuSearchText(needle);
  if (!n) return true;
  return normalizeMenuSearchText(haystack).includes(n);
}
function sanitizeMenuLabel(value) {
  return value
    .normalize("NFC")
    .replace(ODD_SPACE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

assert.match(textLib, /\\u00a0\\u1680\\u2000-\\u200b/);

const nbspName = "โปรโมชั่น\u00a0วาฟเฟิล";
assert.equal(sanitizeMenuLabel(nbspName), "โปรโมชั่น วาฟเฟิล");
assert.ok(menuTextIncludes(nbspName, "วาฟเฟิล"));
assert.equal(
  normalizeMenuSearchText("ชิ้น  แบบเดียวกัน"),
  normalizeMenuSearchText("ชิ้น แบบเดียวกัน"),
);
assert.equal(sanitizeMenuLabel("ชิ้น  แบบเดียวกัน"), "ชิ้น แบบเดียวกัน");
assert.equal(sanitizeMenuLabel("ชิ้นแบบเดียวกัน"), "ชิ้นแบบเดียวกัน");
assert.notEqual(
  sanitizeMenuLabel("ชิ้น แบบเดียวกัน"),
  sanitizeMenuLabel("ชิ้นแบบเดียวกัน"),
);

console.log("ok: menu-price-placeholder-nbsp");
