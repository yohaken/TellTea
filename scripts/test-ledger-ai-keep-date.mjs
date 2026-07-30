/**
 * AI receipt extract must not overwrite accounting dates.
 * พ.ศ. years (2568) must convert to ค.ศ. (2025) — else iOS shows ~3112.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const pageSrc = read("src/app/ledger/page.tsx");
const ownerSrc = read("src/app/owner-books/page.tsx");
const billSrc = read("src/components/BillNoticeLedgerPanel.tsx");
const vatSrc = read("src/components/vat-sales/BooksVatEntryDetailModal.tsx");
const utils = read("src/lib/utils.ts");
const fn = read("functions/extract-owner-book.js");
const ai = read("src/lib/owner-books-ai.ts");
const version = read("src/lib/version.ts");

assert.match(pageSrc, /extractOwnerBookFromReceipt/);
assert.doesNotMatch(pageSrc, /if \(result\.date\) setDate\(result\.date\)/);
assert.match(pageSrc, /Keep the accounting date|Keep the saved accounting date/);

assert.doesNotMatch(ownerSrc, /if \(result\.date\) setDate\(result\.date\)/);
assert.doesNotMatch(billSrc, /if \(result\.date\) setDate\(result\.date\)/);
assert.doesNotMatch(vatSrc, /if \(result\.date\) setDate\(result\.date\)/);

assert.match(utils, /export function toCeYear/);
assert.match(utils, /while \(n >= 2400 && n < 4000\) n -= 543/);
assert.match(utils, /export function normalizeAccountingDateKey/);
assert.match(fn, /function toCeYear/);
assert.match(fn, /while \(y >= 2400 && y < 4000\) y -= 543/);
assert.match(fn, /ค\.ศ\. YYYY-MM-DD/);
assert.match(ai, /normalizeAccountingDateKey/);
assert.match(version, /APP_BUILD = 474/);

function toCeYear(raw) {
  if (!Number.isFinite(raw)) return null;
  let n = raw;
  while (n >= 2400 && n < 4000) n -= 543;
  if (n >= 1900 && n <= 2100) return n;
  if (n >= 0 && n < 100) return 2500 + n - 543;
  return null;
}
function normalizeAccountingDateKey(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [ys, ms, ds] = s.split("-").map(Number);
  const y = toCeYear(ys);
  if (y == null || y < 2000 || y > 2100) return "";
  return `${y}-${String(ms).padStart(2, "0")}-${String(ds).padStart(2, "0")}`;
}

assert.equal(toCeYear(2568), 2025);
assert.equal(toCeYear(68), 2025);
assert.equal(toCeYear(2024), 2024);
assert.equal(toCeYear(3112), 2026);
assert.equal(normalizeAccountingDateKey("2568-07-22"), "2025-07-22");
assert.equal(normalizeAccountingDateKey("2024-07-22"), "2024-07-22");
assert.equal(normalizeAccountingDateKey("3112-07-22"), "2026-07-22");

console.log("OK test-ledger-ai-keep-date");
