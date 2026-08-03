import assert from "node:assert/strict";
import {
  BUSINESS_NOTES_DOC,
  BUSINESS_NOTES_TABS,
  compactBusinessNoteRows,
  createBusinessNoteRow,
  normalizeBusinessNotes,
  rowsForTab,
} from "../src/lib/business-notes";

assert.equal(BUSINESS_NOTES_DOC, "businessNotes");
assert.equal(BUSINESS_NOTES_TABS[0].id, "general");

const empty = normalizeBusinessNotes(null);
assert.deepEqual(empty.byTab.general, []);
assert.equal(empty.updatedAt, 0);

const row = createBusinessNoteRow("hello", 100);
assert.ok(row.id);
assert.equal(row.text, "hello");
assert.equal(row.updatedAt, 100);

const parsed = normalizeBusinessNotes({
  byTab: {
    general: [
      { id: "a", text: "one", updatedAt: 1 },
      { id: "b", text: "two", updatedAt: 2 },
    ],
  },
  updatedAt: 9,
  updatedBy: "owner",
});
assert.equal(rowsForTab(parsed, "general").length, 2);
assert.equal(parsed.updatedBy, "owner");

const legacy = normalizeBusinessNotes({
  rows: [{ id: "x", text: "legacy", updatedAt: 3 }],
  updatedAt: 4,
});
assert.equal(legacy.byTab.general[0].text, "legacy");

const compacted = compactBusinessNoteRows([
  { id: "1", text: "keep", updatedAt: 1 },
  { id: "2", text: "  ", updatedAt: 2 },
  { id: "3", text: "", updatedAt: 3 },
]);
assert.equal(compacted.length, 1);
assert.equal(compacted[0].text, "keep");

const midBlank = compactBusinessNoteRows([
  { id: "1", text: "a", updatedAt: 1 },
  { id: "2", text: "", updatedAt: 2 },
  { id: "3", text: "c", updatedAt: 3 },
  { id: "4", text: "", updatedAt: 4 },
]);
assert.equal(midBlank.length, 3);
assert.equal(midBlank[1].text, "");

console.log("test-business-notes-lib: ok");
