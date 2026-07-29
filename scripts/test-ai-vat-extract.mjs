/**
 * AI-first VAT extract: CF prompt + client + UI verify checkbox.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cf = readFileSync(join(root, "functions/extract-owner-book.js"), "utf8");
const ai = readFileSync(join(root, "src/lib/owner-books-ai.ts"), "utf8");
const fieldset = readFileSync(join(root, "src/components/EntryVatFieldset.tsx"), "utf8");
const ledger = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const owner = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const entryVat = readFileSync(join(root, "src/lib/entry-vat.ts"), "utf8");

assert.match(cf, /vatInput/);
assert.match(cf, /vatSeenOnBill/);
assert.match(cf, /ห้ามคำนวณ VAT จากยอดรวม/);
assert.match(cf, /hasVat/);

assert.match(ai, /normalizeAiVatExtract/);
assert.match(entryVat, /vatSeenOnBill/);

assert.match(fieldset, /ตรวจแล้ว · ยอดภาษีตรงกับบิล/);
assert.match(fieldset, /ใช้ประมาณ/);
assert.match(fieldset, /vatVerified/);
assert.match(fieldset, /vatSource/);
assert.match(fieldset, /AI อ่าน/);

assert.match(ledger, /extractOwnerBookFromReceipt/);
assert.match(ledger, /vatVerified/);
assert.match(owner, /EntryVatFieldset/);
assert.match(owner, /vatSource/);

assert.match(entryVat, /VatSource/);
assert.match(entryVat, /vatVerified/);
assert.doesNotMatch(entryVat, /fallback.*proposePurchaseVatInput\(amountInclusive\)/);

console.log("OK test-ai-vat-extract");
