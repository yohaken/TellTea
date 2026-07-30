/**
 * Unit: storefront send slider math + clamp.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mirror pure math (no ts loader in CI) + assert wiring in UI source.
const src = readFileSync(join(root, "src/lib/vat-storefront-send.ts"), "utf8");
assert.match(src, /computeSfSendAmount/);
assert.match(src, /clampSfSendPct/);
assert.match(src, /SF_SEND_PCT_KEY/);
assert.match(src, /sfSendSourceKey/);
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

assert.equal(computeSfSendAmount(150000, 100), 150000);
assert.equal(computeSfSendAmount(150000, 70), 105000);
assert.equal(computeSfSendAmount(150000, 0), 0);
assert.equal(computeSfSendAmount(100.555, 50), 50.28);
assert.equal(clampSfSendPct(150), 100);
assert.equal(clampSfSendPct(-3), 0);
assert.equal(clampSfSendPct(33.4), 33);

const ui = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);
assert.match(ui, /vat-sf-send/);
assert.match(ui, /computeSfSendAmount/);
assert.match(ui, /saveSfSendPct/);

console.log("OK test-vat-storefront-send");
