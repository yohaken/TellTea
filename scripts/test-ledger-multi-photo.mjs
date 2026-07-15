/**
 * Ledger multi-receipt helpers — normalize legacy receiptUrl + receiptUrls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerSrc = readFileSync(join(root, "src/lib/ledger.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const multiSrc = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");

assert.match(ledgerSrc, /LEDGER_RECEIPT_MAX\s*=\s*6/);
assert.match(ledgerSrc, /getLedgerReceiptUrls/);
assert.match(ledgerSrc, /receiptUrls/);
assert.match(pageSrc, /PhotoAttachMultiField/);
assert.match(pageSrc, /LEDGER_RECEIPT_MAX/);
assert.match(pageSrc, /EntryPhotoIndicator/);
assert.match(multiSrc, /allowCamera/);
assert.match(multiSrc, /capture="environment"/);

function getLedgerReceiptUrls(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.receiptUrls)) {
    return entry.receiptUrls.map(String).filter((u) => u.trim());
  }
  const legacy = (entry.receiptUrl || "").trim();
  return legacy ? [legacy] : [];
}

assert.deepEqual(getLedgerReceiptUrls({ receiptUrl: "a" }), ["a"]);
assert.deepEqual(getLedgerReceiptUrls({ receiptUrls: ["a", "b"], receiptUrl: "a" }), ["a", "b"]);
assert.deepEqual(getLedgerReceiptUrls({ receiptUrls: [] }), []);
assert.deepEqual(getLedgerReceiptUrls(null), []);

console.log("OK test-ledger-multi-photo");
