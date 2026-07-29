/**
 * Guard: expense VAT + payer (E0–E5) — fold UI, ledger, sync, AI extract
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/expense-vat.ts");
const sync = read("src/lib/expense-vat-sync.ts");
const fold = read("src/components/ExpenseVatPayerFold.tsx");
const bill = read("src/lib/bill-notices.ts");
const billUi = read("src/components/BillNoticeLedgerPanel.tsx");
const owner = read("src/lib/owner-books.ts");
const ownerUi = read("src/app/owner-books/page.tsx");
const ledger = read("src/lib/ledger.ts");
const ledgerUi = read("src/app/ledger/page.tsx");
const types = read("src/lib/types.ts");
const ai = read("src/lib/owner-books-ai.ts");
const cf = read("functions/extract-owner-book.js");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const phases = read("docs/expense-vat-payer-phases.md");

assert.match(version, /APP_BUILD = 394/);
assert.ok(existsSync(join(root, "docs/expense-vat-payer-phases.md")));
assert.match(phases, /E0|E1|E3|E4|E5|vatMode|ผู้จ่าย/);

assert.match(lib, /export type ExpenseVatMode/);
assert.match(lib, /vendor/);
assert.match(lib, /vatInputInvoiceId/);
assert.match(lib, /shouldSyncVatInputInvoice/);
assert.match(lib, /buildExpenseVatPayerPayload/);

assert.match(sync, /syncExpenseVatInputInvoice/);
assert.match(sync, /createVatInputInvoice/);
assert.match(sync, /withSyncedVatInputId/);

assert.match(fold, /export function ExpenseVatPayerFold/);
assert.match(fold, /<details className="expense-vat-fold">/);
assert.match(fold, /ผู้ขาย/);
assert.doesNotMatch(fold, /open=\{true\}/);

assert.match(bill, /syncExpenseVatInputInvoice/);
assert.match(billUi, /ExpenseVatPayerFold/);
assert.match(billUi, /mergeExtractIntoExpenseVat/);
assert.match(billUi, /col-vat/);

assert.match(owner, /vatInputInvoiceId/);
assert.match(ownerUi, /ExpenseVatPayerFold/);
assert.match(ownerUi, /syncExpenseVatInputInvoice/);
assert.match(ownerUi, /mergeExtractIntoExpenseVat/);

assert.match(types, /ExpenseVatPayerFields/);
assert.match(ledger, /buildExpenseVatPayerPayload/);
assert.match(ledgerUi, /ExpenseVatPayerFold/);
assert.match(ledgerUi, /col-vat/);
assert.match(ledgerUi, /syncExpenseVatInputInvoice/);

assert.match(ai, /mergeExtractIntoExpenseVat/);
assert.match(ai, /vatMode/);
assert.match(ai, /invoiceName/);
assert.match(cf, /vatMode/);
assert.match(cf, /invoiceNameOk/);
assert.match(cf, /vendor/);

assert.match(css, /\.expense-vat-fold\b/);
assert.match(css, /\.bill-notice-vat-chip\b/);

if (!existsSync(join(root, "node_modules/firebase"))) {
  console.log("SKIP expense-vat runtime (no node_modules/firebase)");
  console.log("OK test-expense-vat-payer");
  process.exit(0);
}

const runner = `
import assert from "node:assert/strict";
import {
  buildExpenseVatPayerPayload,
  emptyExpenseVatPayer,
  expenseVatFromGross,
  shouldSyncVatInputInvoice,
  shortExpenseVatHint,
} from "../src/lib/expense-vat.ts";
import { mergeExtractIntoExpenseVat } from "../src/lib/owner-books-ai.ts";

const empty = emptyExpenseVatPayer();
assert.equal(empty.vatMode, "unknown");
assert.equal(empty.vendor, "");
assert.equal(buildExpenseVatPayerPayload(empty, 107).vatInput, 0);
assert.equal(shouldSyncVatInputInvoice(empty), false);

const inc = buildExpenseVatPayerPayload(
  { vatMode: "inclusive", invoiceNameOk: "ok" },
  107,
);
assert.equal(inc.vatInput, expenseVatFromGross(107).vatInput);
assert.equal(shouldSyncVatInputInvoice(inc), true);
assert.match(shortExpenseVatHint(inc), /VAT/);

const merged = mergeExtractIntoExpenseVat(empty, {
  vatMode: "inclusive",
  vatInput: 7,
  vatBase: 100,
  taxInvoiceNo: "AB1",
  vendor: "ร้านไฟ",
  invoiceName: "TellTea",
  invoiceNameOk: "ok",
});
assert.equal(merged.vatMode, "inclusive");
assert.equal(merged.vendor, "ร้านไฟ");
assert.equal(merged.invoiceName, "TellTea");

console.log("OK expense-vat runtime");
`;
const tmp = join(root, "scripts/.tmp-expense-vat-run.mts");
writeFileSync(tmp, runner);
const res = spawnSync("npx", ["--yes", "tsx", tmp], { cwd: root, encoding: "utf8" });
try {
  unlinkSync(tmp);
} catch {
  /* ignore */
}
if (res.status !== 0) {
  console.error(res.stdout, res.stderr);
  process.exit(res.status || 1);
}
process.stdout.write(res.stdout);
console.log("OK test-expense-vat-payer");
