import assert from "node:assert/strict";
import { defaultVatImportAiNotesText } from "../src/lib/vat-import-ai-notes";

const t = defaultVatImportAiNotesText();
assert.ok(t.includes("vatImportAiNotes"));
assert.ok(t.includes("#vat-import-ai-notes"));
assert.ok(t.includes("ใช้เข้าเดือน"));
assert.ok(t.includes("โต๊ะจูน"));
assert.ok(t.includes("วางข้อความ") || t.includes("กรอก"));


console.log("test-vat-import-ai-notes: ok");
