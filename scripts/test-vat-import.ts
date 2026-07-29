/**
 * Pure tests for VAT import helpers (I0).
 */
import assert from "node:assert/strict";
import {
  emptyVatImportRow,
  isDateKey,
  monthKeyFromDateKey,
  sumVatImportDraftByChannel,
  vatImportDedupeKey,
  type VatImportRow,
} from "../src/lib/vat-import";

assert.equal(isDateKey("2026-07-01"), true);
assert.equal(isDateKey("2026-02-30"), false);
assert.equal(isDateKey("2026-7-1"), false);
assert.equal(monthKeyFromDateKey("2026-07-15"), "2026-07");

assert.equal(
  vatImportDedupeKey({
    channel: "grab",
    externalId: "G-1",
    invoiceNo: "INV",
    dateKey: "2026-07-01",
    rowKind: "sales",
  }),
  "grab|ext:G-1",
);
assert.equal(
  vatImportDedupeKey({
    channel: "grab",
    invoiceNo: "INV-9",
    dateKey: "2026-07-01",
    rowKind: "tax_invoice",
  }),
  "grab|inv:INV-9",
);
assert.equal(
  vatImportDedupeKey({
    channel: "shopee",
    dateKey: "2026-07-02",
    rowKind: "sales",
  }),
  "shopee|2026-07-02|sales",
);

const blank = emptyVatImportRow("2026-07", { channel: "lineman" });
assert.equal(blank.monthKey, "2026-07");
assert.equal(blank.dateKey, "2026-07-01");
assert.equal(blank.channel, "lineman");
assert.equal(blank.adapterId, "manual");

const rows = [
  {
    id: "a",
    channel: "grab",
    status: "draft",
    grossInclusive: 1000,
    netTransfer: 700,
    gpVat: 21,
  },
  {
    id: "b",
    channel: "grab",
    status: "skipped",
    grossInclusive: 500,
    netTransfer: 0,
    gpVat: 0,
  },
  {
    id: "c",
    channel: "shopee",
    status: "draft",
    grossInclusive: 200,
    netTransfer: 150,
    gpVat: 0,
  },
] as VatImportRow[];

const sum = sumVatImportDraftByChannel(rows);
assert.equal(sum.grab.count, 1);
assert.equal(sum.grab.gross, 1000);
assert.equal(sum.grab.netTransfer, 700);
assert.equal(sum.shopee.count, 1);
assert.equal(sum.shopee.gross, 200);

console.log("test-vat-import: ok");
