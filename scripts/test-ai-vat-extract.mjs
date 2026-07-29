/**
 * AI-first VAT extract: CF prompt + multi-photo merge + client verify UI.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cf = readFileSync(join(root, "functions/extract-owner-book.js"), "utf8");
const merge = readFileSync(join(root, "functions/merge-receipt-extract.js"), "utf8");
const ai = readFileSync(join(root, "src/lib/owner-books-ai.ts"), "utf8");
const fieldset = readFileSync(join(root, "src/components/EntryVatFieldset.tsx"), "utf8");
const ledger = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const owner = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const entryVat = readFileSync(join(root, "src/lib/entry-vat.ts"), "utf8");
const receipts = readFileSync(join(root, "src/lib/receipts.ts"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(cf, /vatInput/);
assert.match(cf, /vatSeenOnBill/);
assert.match(cf, /ห้ามคำนวณ/);
assert.match(cf, /hasVat/);
assert.match(cf, /ท็อปเวิลด์/);
assert.match(cf, /ฐานภาษี 7%/);
assert.match(cf, /docKind/);
assert.match(cf, /bank_slip/);
assert.match(cf, /tax_invoice/);
assert.match(cf, /extractOneImage/);
assert.match(cf, /mergeExtractResults/);
assert.match(cf, /MEDIA_RESOLUTION_HIGH/);
assert.match(cf, /thinkingBudget/);
assert.match(cf, /VAT_RETRY_SYSTEM_PROMPT/);
assert.match(cf, /timeoutSeconds: 180/);
assert.doesNotMatch(cf, /completeVatFromBill/);
assert.doesNotMatch(cf, /vat-from-bill/);

assert.match(merge, /mergeExtractResults/);
assert.match(merge, /bank_slip/);
assert.match(merge, /tax_invoice/);

assert.match(ai, /normalizeAiVatExtract/);
assert.match(ai, /timeout:\s*180_000/);
assert.match(entryVat, /vatSeenOnBill/);
assert.match(entryVat, /ท็อปเวิลด์/);

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

assert.match(receipts, /maxShortEdge/);
assert.match(receipts, /maxLongEdge/);
assert.match(version, /APP_BUILD = 456/);

console.log("OK test-ai-vat-extract");
