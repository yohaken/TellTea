/**
 * Guard: expense VAT + payer fields (E0/E1) — fold UI + bill/owner wiring
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/expense-vat.ts");
const fold = read("src/components/ExpenseVatPayerFold.tsx");
const bill = read("src/lib/bill-notices.ts");
const billUi = read("src/components/BillNoticeLedgerPanel.tsx");
const owner = read("src/lib/owner-books.ts");
const ownerUi = read("src/app/owner-books/page.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const phases = read("docs/expense-vat-payer-phases.md");

assert.match(version, /APP_BUILD = 392/);
assert.ok(existsSync(join(root, "docs/expense-vat-payer-phases.md")));
assert.match(phases, /E0|E1|vatMode|ผู้จ่าย/);

assert.match(lib, /export type ExpenseVatMode/);
assert.match(lib, /export type ExpensePayer/);
assert.match(lib, /buildExpenseVatPayerPayload/);
assert.match(lib, /expenseVatFromGross/);
assert.match(lib, /shortExpenseVatHint/);
assert.match(lib, /ร้านจ่าย/);

assert.match(fold, /export function ExpenseVatPayerFold/);
assert.match(fold, /<details className="expense-vat-fold">/);
assert.match(fold, /VAT \/ ผู้จ่าย/);
assert.doesNotMatch(fold, /open=\{true\}/);

assert.match(bill, /ExpenseVatPayerFields/);
assert.match(bill, /buildExpenseVatPayerPayload/);
assert.match(bill, /\.\.\.vat/);
assert.match(billUi, /ExpenseVatPayerFold/);
assert.match(billUi, /expense-fold-box/);
assert.match(billUi, /col-vat/);
assert.match(billUi, /bill-notice-summary-toggle/);

assert.match(owner, /ExpenseVatPayerFields/);
assert.match(owner, /buildExpenseVatPayerPayload/);
assert.match(ownerUi, /ExpenseVatPayerFold/);
assert.match(ownerUi, /col-vat/);

assert.match(css, /\.expense-vat-fold\b/);
assert.match(css, /\.expense-vat-fold-summary\b/);
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
  shortExpenseVatHint,
} from "../src/lib/expense-vat.ts";

const empty = emptyExpenseVatPayer();
assert.equal(empty.vatMode, "unknown");
assert.equal(buildExpenseVatPayerPayload(empty, 107).vatInput, 0);

const inc = buildExpenseVatPayerPayload({ vatMode: "inclusive" }, 107);
assert.equal(inc.vatInput, expenseVatFromGross(107).vatInput);
assert.equal(inc.vatBase + inc.vatInput, 107);
assert.match(shortExpenseVatHint(inc), /VAT/);

const none = buildExpenseVatPayerPayload({ vatMode: "none", vatInput: 9 }, 100);
assert.equal(none.vatInput, 0);

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
