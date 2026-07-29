import assert from "node:assert/strict";
import {
  grabCsvToImportRows,
  looksLikeGrabTransactionCsv,
  parseGrabTransactionCsv,
} from "../src/lib/vat-import-grab-csv";
import { previewApplyVatImportRows } from "../src/lib/vat-import-apply";
import type { VatImportRow } from "../src/lib/vat-import";

const csv = `Date,Gross Sales,Commission,Net Payout
2026-07-01,1000.00,300.00,700.00
2026-07-01,500.00,150.00,350.00
2026-07-02,800.00,240.00,560.00
`;

assert.equal(looksLikeGrabTransactionCsv(csv), true);
const parsed = parseGrabTransactionCsv(csv);
assert.equal(parsed.monthKey, "2026-07");
assert.equal(parsed.days.length, 2);
const d1 = parsed.days.find((d) => d.dateKey === "2026-07-01")!;
assert.equal(d1.grossInclusive, 1500);
assert.equal(d1.fee, 450);
assert.equal(d1.netTransfer, 1050);
assert.equal(d1.lineCount, 2);

const rows = grabCsvToImportRows(parsed);
assert.equal(rows.length, 2);
assert.equal(rows[0]?.channel, "grab");

const fakeRows = rows.map(
  (r, i) =>
    ({
      id: `r${i}`,
      ...r,
      createdAt: 0,
      updatedAt: 0,
      updatedBy: "t",
    }) as VatImportRow,
);
const preview = previewApplyVatImportRows("2026-07", fakeRows);
assert.equal(preview.byChannel.grab.gross, 2300);
assert.equal(preview.byChannel.grab.netTransfer, 1610);
assert.ok(preview.deliveryGpVat > 0);

console.log("test-vat-import-grab-csv: ok");
