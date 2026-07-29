/**
 * Pure tests — month scaffold + slot keys
 */
import assert from "node:assert/strict";
import {
  listMonthDateKeys,
  planMonthScaffoldRows,
  salesSlotKey,
  scaffoldSlotExternalId,
  MONTH_SCAFFOLD_ADAPTER_ID,
  VAT_IMPORT_SCAFFOLD_CHANNELS,
} from "../src/lib/vat-import-scaffold";
import {
  VAT_IMPORT_AI_RULES,
  VAT_IMPORT_CHANNEL_GUIDE,
  VAT_IMPORT_COLUMN_GUIDE,
  VAT_IMPORT_WORKFLOW_NOTES,
} from "../src/lib/vat-import-guide";


const days = listMonthDateKeys("2026-07");
assert.equal(days.length, 31);
assert.equal(days[0], "2026-07-01");
assert.equal(days[30], "2026-07-31");
assert.deepEqual(listMonthDateKeys("bad"), []);

const planned = planMonthScaffoldRows("2026-07");
assert.equal(planned.length, 31 * VAT_IMPORT_SCAFFOLD_CHANNELS.length);
assert.equal(planned[0]?.adapterId, MONTH_SCAFFOLD_ADAPTER_ID);
assert.equal(planned[0]?.grossInclusive, 0);
assert.equal(planned[0]?.externalId, "slot:shopee:2026-07-01");
assert.equal(
  scaffoldSlotExternalId("grab", "2026-07-15"),
  "slot:grab:2026-07-15",
);
assert.equal(salesSlotKey("lineman", "2026-07-02"), "lineman|2026-07-02|sales");

const keys = new Set(
  planned.map((r) => salesSlotKey(r.channel, r.dateKey)),
);
assert.equal(keys.size, planned.length);

assert.ok(VAT_IMPORT_COLUMN_GUIDE.length >= 6);
assert.ok(VAT_IMPORT_CHANNEL_GUIDE.some((g) => g.channel === "grab"));
assert.ok(VAT_IMPORT_WORKFLOW_NOTES.length >= 3);
assert.ok(VAT_IMPORT_AI_RULES.some((r) => r.includes("ไฟล์ต้นทาง")));
assert.ok(VAT_IMPORT_AI_RULES.some((r) => r.includes("ใช้เข้าเดือน")));


console.log("test-vat-import-scaffold: ok");
