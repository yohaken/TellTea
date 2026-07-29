import assert from "node:assert/strict";
import { parseVatImportPasteText } from "../src/lib/vat-import-paste";

const r = parseVatImportPasteText(
  [
    "# comment",
    "2026-07-01 GB 1200 84 1116",
    "2026-07-02 LM 800",
    "2026-07-03 SF 500 0 500 35 INV-1",
    "2026-06-01 GB 100",
    "bad line",
  ].join("\n"),
  "2026-07",
);

assert.equal(r.inputs.length, 3);
assert.equal(r.inputs[0]?.channel, "grab");
assert.equal(r.inputs[0]?.grossInclusive, 1200);
assert.equal(r.inputs[0]?.fee, 84);
assert.equal(r.inputs[1]?.channel, "lineman");
assert.equal(r.inputs[2]?.invoiceNo, "INV-1");
assert.ok(r.errors.length >= 1);

const dmy = parseVatImportPasteText("01/07/2026 sf 100", "2026-07");
assert.equal(dmy.inputs[0]?.dateKey, "2026-07-01");
assert.equal(dmy.inputs[0]?.channel, "shopee");

console.log("test-vat-import-paste: ok");
