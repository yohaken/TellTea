/**
 * P6 local checks: reconcile range · confirmed-only books · input VAT base.
 * Run: npx tsx scripts/test-vat-p6.ts
 */
import {
  emptyDailySales,
  recomputeDailyTotals,
  computeVatFromGross,
  roundMoney,
  type ChannelAmount,
  type DailySalesDoc,
} from "../src/lib/vat-sales";
import { _dateKeysInRange, _sumChannelInDocs } from "../src/lib/vat-sales-reconcile";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const amt = (g: number): ChannelAmount => ({
  grossInclusive: g,
  fee: 0,
  netTransfer: 0,
});

function day(key: string, grab: number, status: "draft" | "confirmed"): DailySalesDoc {
  const d = emptyDailySales(key);
  d.delivery.grab = amt(grab);
  Object.assign(d, recomputeDailyTotals({ storefront: d.storefront, delivery: d.delivery }));
  d.status = status;
  return d;
}

const keys = _dateKeysInRange("2026-07-14", "2026-07-20");
assert(keys.length === 7, `week keys ${keys.length}`);
assert(keys[0] === "2026-07-14" && keys[6] === "2026-07-20", "week bounds");

const docs: Record<string, DailySalesDoc> = {
  "2026-07-14": day("2026-07-14", 100, "confirmed"),
  "2026-07-15": day("2026-07-15", 50, "draft"),
  "2026-07-16": day("2026-07-16", 0, "confirmed"),
};

const all = _sumChannelInDocs(docs, keys, "grab");
assert(all.gross === 150, `all gross ${all.gross}`);

const conf = _sumChannelInDocs(docs, keys, "grab", { confirmedOnly: true });
assert(conf.gross === 100, `confirmed gross ${conf.gross}`);
assert(conf.days === 2, `confirmed days include zero-gross confirmed got ${conf.days}`);

// input VAT base when custom vatInput
const gross = 107;
const vatIn = 5;
const base = roundMoney(Math.max(0, gross - vatIn));
assert(base === 102, `custom vatBase ${base}`);
const auto = computeVatFromGross(107);
assert(auto.vatBase === 100 && auto.vatOutput === 7, "auto 7%");

console.log("OK vat-p6 · reconcile · confirmed-only · vat input math");
