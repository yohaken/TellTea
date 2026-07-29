import assert from "node:assert/strict";
import { computeImportFillStats, formatFillPct } from "../src/lib/vat-import-fill";
import { verifyVatImportRows } from "../src/lib/vat-import-verify";
import type { VatImportRow } from "../src/lib/vat-import";

const rows = [
  {
    id: "1",
    monthKey: "2026-07",
    dateKey: "2026-07-01",
    channel: "grab",
    status: "draft",
    grossInclusive: 1000,
    fee: 70,
    netTransfer: 930,
    gpVat: 0,
    invoiceNo: "",
  },
  {
    id: "2",
    monthKey: "2026-07",
    dateKey: "2026-07-02",
    channel: "grab",
    status: "draft",
    grossInclusive: 500,
    fee: 600,
    netTransfer: 0,
    gpVat: 0,
    invoiceNo: "",
  },
] as VatImportRow[];

const fill = computeImportFillStats("2026-07", rows);
assert.equal(fill.daysInMonth, 31);
assert.equal(fill.byChannel.grab.daysFilled, 2);
assert.ok(fill.byChannel.grab.pct > 0);
assert.equal(formatFillPct(10), "10%");

const v = verifyVatImportRows(rows);
assert.ok(v.warnCount >= 1);
assert.ok(v.issues.some((i) => i.code === "fee-gt-gross"));

console.log("test-vat-import-fill-verify: ok");
