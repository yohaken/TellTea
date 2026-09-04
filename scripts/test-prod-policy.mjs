/**
 * Production policy: min qty range per product, waste % of bonus, compact popup.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/prod-policy.ts");
const prod = read("src/lib/production.ts");
const page = read("src/app/production/page.tsx");
const popup = read("src/components/ProdPolicyPopup.tsx");
const catalog = read("src/components/ProdCatalogSetup.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(lib, /meta", "prodPolicy"/);
assert.match(lib, /wasteBonusPct/);
assert.match(lib, /productHasMinPolicy/);
assert.match(lib, /summarizeProdPolicyMonth/);
assert.match(lib, /filterProdEntriesOnBangkokDay/);
assert.match(lib, /monthQty: "วันนี้"/);
assert.match(lib, /computeWasteRate/);
assert.match(lib, /formatPolicyRate/);
assert.match(popup, /เรทเสีย/);
assert.match(page, /prod-col-waste-rate/);
assert.match(catalog, /เสีย /);
assert.match(lib, /DEFAULT_PROD_POLICY_LABELS/);
assert.match(prod, /minQtyLow/);
assert.match(prod, /minQtyHigh/);
assert.match(prod, /mapProdProduct/);
assert.match(prod, /wasteBonusPct/);
assert.match(prod, /computeWasteBonusMoney/);
assert.match(page, /ProdPolicyPopup/);
assert.match(page, /computeProdBonus\(row, policy\.wasteBonusPct\)/);
assert.match(page, /หักทิ้ง/);
const bonusLib = read("src/lib/bonus.ts");
const bonusPage = read("src/app/bonus/page.tsx");
assert.match(bonusLib, /computeProdBonus\(row, wasteBonusPct\)/);
assert.match(bonusPage, /subscribeProdPolicy/);
assert.match(bonusPage, /prodPolicy\.wasteBonusPct/);
assert.match(popup, /is-prod-policy/);
assert.match(popup, /filterProdEntriesOnBangkokDay/);
assert.match(popup, /ขั้นต่ำต่อวัน/);
assert.match(catalog, /prod-catalog-min/);
assert.match(catalog, /ชิ้น\/วัน/);
assert.match(page, /ชิ้น\/วัน/);
assert.match(css, /prod-policy-card/);
assert.match(lib, /popupEnabled/);
assert.match(page, /policy.popupEnabled/);
assert.match(page, /onOpenPolicy=\{canSetPolicy/);
assert.match(popup, /ProdPolicyPopupToggle/);
const settings = read("src/app/settings/page.tsx");
assert.match(settings, /ProdPolicyPopupToggle/);
assert.match(version, /APP_BUILD = 863/);

function round2(n) {
  return Math.round(n * 100) / 100;
}
function clampPct(n) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, round2(n));
}
function productHasMinPolicy(p) {
  return (Number(p.minQtyLow) || 0) > 0 || (Number(p.minQtyHigh) || 0) > 0;
}
function formatProdMinRange(low, high) {
  const lo = Math.max(0, Number(low) || 0);
  const hi = Math.max(0, Number(high) || 0);
  if (lo > 0 && hi > 0) {
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    return a === b ? String(a) : `${a}–${b}`;
  }
  if (lo > 0) return `≥ ${lo}`;
  if (hi > 0) return `≤ ${hi}`;
  return "";
}
function computeWasteRate(prodRate, wasteBonusPct) {
  const rate = Math.max(0, Number(prodRate) || 0);
  const pct = clampPct(Number(wasteBonusPct) || 0);
  return rate * (pct / 100);
}
function computeWasteBonusMoney(qtyWaste, prodRate, wasteBonusPct) {
  const waste = Math.max(0, Number(qtyWaste) || 0);
  return round2(waste * computeWasteRate(prodRate, wasteBonusPct));
}
function formatPolicyMoney(amount) {
  if (!(Number(amount) > 0)) return "";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

assert.equal(productHasMinPolicy({}), false);
assert.equal(productHasMinPolicy({ minQtyLow: 0, minQtyHigh: 0 }), false);
assert.equal(productHasMinPolicy({ minQtyLow: 30, minQtyHigh: 60 }), true);
assert.equal(formatProdMinRange(30, 60), "30–60");
assert.equal(formatProdMinRange(60, 30), "30–60");
assert.equal(formatProdMinRange(30, 0), "≥ 30");
assert.equal(formatProdMinRange(0, 60), "≤ 60");
assert.equal(formatProdMinRange(0, 0), "");
assert.equal(computeWasteRate(1.25, 30), 0.375);
assert.equal(computeWasteRate(1.8, 30), 0.54);
assert.equal(computeWasteBonusMoney(10, 1.25, 30), 3.75);
assert.equal(computeWasteBonusMoney(0, 1.25, 30), 0);
assert.equal(formatPolicyMoney(0), "");
assert.equal(formatPolicyMoney(3.75), "3.75");

function bangkokDateKey(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
function filterProdEntriesOnBangkokDay(entries, dayMs = Date.now()) {
  const key = bangkokDateKey(dayMs);
  if (!key) return [];
  return entries.filter((row) => bangkokDateKey(row.date) === key);
}
const dayNoon = Date.parse("2026-09-04T12:00:00+07:00");
const sameDay = Date.parse("2026-09-04T08:00:00+07:00");
const prevDay = Date.parse("2026-09-03T23:30:00+07:00");
assert.equal(
  filterProdEntriesOnBangkokDay([{ date: sameDay }, { date: prevDay }], dayNoon).length,
  1,
);

function netProdBonus(qty, waste, rate, pct, workers) {
  const gross = qty * rate;
  const cut = computeWasteBonusMoney(waste, rate, pct);
  const prodBonus = Math.max(0, round2(gross - cut));
  return { prodBonus, perPerson: prodBonus / Math.max(1, workers) };
}
assert.equal(netProdBonus(50, 0, 1.25, 30, 1).prodBonus, 62.5);
assert.equal(netProdBonus(50, 10, 1.25, 30, 1).prodBonus, 58.75);
assert.equal(netProdBonus(50, 10, 1.25, 0, 1).prodBonus, 62.5);

console.log("OK test-prod-policy");
