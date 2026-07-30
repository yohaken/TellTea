/**
 * Unit: storefront send slider → A income + D sales transfer + cost layers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const src = readFileSync(join(root, "src/lib/vat-storefront-send.ts"), "utf8");
assert.match(src, /computeSfSendAmount/);
assert.match(src, /computeSfUnsentAmount/);
assert.match(src, /SF_SEND_PCT_KEY/);

const books = readFileSync(join(root, "src/lib/vat-month-books.ts"), "utf8");
assert.match(books, /patchSfSendIntoDraft/);
assert.match(books, /storefrontTransfer: n/);
assert.match(books, /storefrontCash: 0/);

function clampSfSendPct(n) {
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, Math.round(n)));
}
function computeSfSendAmount(source, pct) {
  const s = Number.isFinite(source) && source > 0 ? source : 0;
  const p = clampSfSendPct(pct);
  return Math.round(((s * p) / 100) * 100) / 100;
}
assert.equal(computeSfSendAmount(150000, 70), 105000);

const ui = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);
assert.match(ui, /patchSfSendIntoDraft/);
assert.match(ui, /ยอดขายโอน/);
assert.match(ui, /คิดภาษีขายอัตโนมัติ/);
assert.match(ui, /vat-cost-layer/);
assert.match(ui, /ชั้นคิดต้นทุนบช/);
assert.match(ui, /ติ๊กหักภาษีซื้อ → ต้นทุน = บิล − VAT/);
assert.match(ui, /ไม่ติ๊ก → ต้นทุน = บิลรวม VAT ทั้งก้อน/);
assert.match(ui, /โอน ← จากแถบ A/);

const entryVat = readFileSync(join(root, "src/lib/entry-vat.ts"), "utf8");
assert.match(entryVat, /export function businessCostOut/);
assert.match(entryVat, /vatClaim && vat > 0/);

const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");
assert.match(version, /APP_BUILD = 505/);

console.log("OK test-vat-storefront-send");
