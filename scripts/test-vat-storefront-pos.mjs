/**
 * Unit: nPOS storefront connect → tenders × % → A+D patch
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const pos = read("src/lib/vat-storefront-pos.ts");
assert.match(pos, /SF_POS_CONNECT_FROM_MONTH = "2026-08"/);
assert.match(pos, /export function defaultPosConnectEnabled/);
assert.match(pos, /export function loadSfPosConnect/);
assert.match(pos, /export function saveSfPosConnect/);
assert.match(pos, /export function scaleSfSendTenders/);
assert.match(pos, /export async function fetchPosStorefrontTenderTotalsByMonth/);
assert.match(pos, /status === "voided"/);
assert.match(pos, /bangkokDateKey/);
assert.match(pos, /promptpay/);
assert.match(pos, /ไม่ใช้รอบกะ/);
assert.doesNotMatch(pos, /shiftRound|shift_round/);

const books = read("src/lib/vat-month-books.ts");
assert.match(books, /export function patchSfSendTendersIntoDraft/);
assert.match(books, /storefrontCash: cash/);
assert.match(books, /storefrontTransfer: transfer/);

const ui = read("src/components/vat-sales/VatMonthBooks.tsx");
assert.match(ui, /patchSfSendTendersIntoDraft/);
assert.match(ui, /fetchPosStorefrontTenderTotalsByMonth/);
assert.match(ui, /vat-sf-pos-connect/);
assert.match(ui, /ดึงยอดหน้าร้านจาก nPOS/);
assert.match(ui, /onSfPosConnectChange/);
assert.match(ui, /disconnectSfPos/);
assert.match(ui, /sfPosConnect/);
assert.match(ui, /→ สด/);

const css = read("src/app/globals.css");
assert.match(css, /\.vat-sf-pos-connect\s*\{/);
assert.match(css, /\.vat-sf-pos-connect\.is-on/);

// Pure helpers mirrored from vat-storefront-pos (no firebase)
function defaultPosConnectEnabled(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return false;
  return monthKey >= "2026-08";
}
assert.equal(defaultPosConnectEnabled("2026-07"), false);
assert.equal(defaultPosConnectEnabled("2026-08"), true);
assert.equal(defaultPosConnectEnabled("2026-09"), true);
assert.equal(defaultPosConnectEnabled("bad"), false);

function normalizeMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x * 100) / 100;
}
function scaleSfSendTenders(tenders, pct) {
  const p = Number.isFinite(pct)
    ? Math.min(100, Math.max(0, Math.round(pct)))
    : 100;
  const scale = (n) => Math.round(((normalizeMoney(n) * p) / 100) * 100) / 100;
  return { cash: scale(tenders.cash), transfer: scale(tenders.transfer) };
}
assert.deepEqual(scaleSfSendTenders({ cash: 1000, transfer: 4000 }, 70), {
  cash: 700,
  transfer: 2800,
});
assert.deepEqual(scaleSfSendTenders({ cash: 333, transfer: 0 }, 50), {
  cash: 166.5,
  transfer: 0,
});

function patchSfSendTendersIntoDraft(draft, tenders) {
  const cash = normalizeMoney(tenders.cash);
  const transfer = normalizeMoney(tenders.transfer);
  const income = Math.round((cash + transfer) * 100) / 100;
  return {
    ...draft,
    transfer: { ...draft.transfer, storefront: income },
    sales: {
      ...draft.sales,
      storefrontCash: cash,
      storefrontTransfer: transfer,
    },
  };
}
const patched = patchSfSendTendersIntoDraft(
  {
    transfer: { storefront: 0 },
    sales: { storefrontCash: 0, storefrontTransfer: 0 },
  },
  { cash: 700, transfer: 2800 },
);
assert.equal(patched.transfer.storefront, 3500);
assert.equal(patched.sales.storefrontCash, 700);
assert.equal(patched.sales.storefrontTransfer, 2800);

const version = read("src/lib/version.ts");
const build = Number(version.match(/APP_BUILD = (\d+)/)?.[1] || 0);
assert.ok(build >= 626, `APP_BUILD should be >= 626, got ${build}`);
// month-switch persist guards (companion feature)
assert.match(
  read("src/components/vat-sales/VatMonthBooks.tsx"),
  /flushDirtySave|changeMonth/,
);

console.log("OK test-vat-storefront-pos");
