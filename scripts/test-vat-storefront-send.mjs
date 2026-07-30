/**
 * Unit: storefront send slider math + clamp + real-profit note.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const src = readFileSync(join(root, "src/lib/vat-storefront-send.ts"), "utf8");
assert.match(src, /computeSfSendAmount/);
assert.match(src, /computeSfUnsentAmount/);
assert.match(src, /computeRealProfitAfterVat/);
assert.match(src, /computeNetProfitMarginPct/);
assert.match(src, /clampSfSendPct/);
assert.match(src, /SF_SEND_PCT_KEY/);
assert.match(src, /telltea\.vat\.sfSendPct/);

function clampSfSendPct(n) {
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, Math.round(n)));
}
function computeSfSendAmount(source, pct) {
  const s = Number.isFinite(source) && source > 0 ? source : 0;
  const p = clampSfSendPct(pct);
  return Math.round(((s * p) / 100) * 100) / 100;
}
function computeSfUnsentAmount(source, pct) {
  const s = Number.isFinite(source) && source > 0 ? source : 0;
  return Math.round((s - computeSfSendAmount(s, pct)) * 100) / 100;
}
function computeRealProfitAfterVat(profitAfterVat, unsent) {
  if (profitAfterVat == null || !Number.isFinite(profitAfterVat)) return null;
  const u = Number.isFinite(unsent) && unsent > 0 ? unsent : 0;
  return Math.round((profitAfterVat + u) * 100) / 100;
}
function computeNetProfitMarginPct(profitAfterVat, incomeTotal) {
  if (profitAfterVat == null || !Number.isFinite(profitAfterVat)) return null;
  if (!Number.isFinite(incomeTotal) || incomeTotal <= 0) return null;
  return Math.round((profitAfterVat / incomeTotal) * 10000) / 100;
}

assert.equal(computeSfSendAmount(150000, 70), 105000);
assert.equal(computeSfUnsentAmount(150000, 70), 45000);
assert.equal(computeSfUnsentAmount(150000, 100), 0);
assert.equal(computeRealProfitAfterVat(20000, 45000), 65000);
assert.equal(computeRealProfitAfterVat(null, 45000), null);
assert.equal(computeNetProfitMarginPct(20000, 100000), 20);
assert.equal(computeNetProfitMarginPct(20000, 0), null);

const ui = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);
assert.match(ui, /vat-sf-send-unsent/);
assert.match(ui, /vat-c-real-note/);
assert.match(ui, /กำไรจริง/);
assert.match(ui, /อัตรากำไรสุทธิ/);
assert.match(ui, /computeSfUnsentAmount/);

console.log("OK test-vat-storefront-send");
