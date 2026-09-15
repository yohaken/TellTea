/**
 * Guard: ตารางแจ้งบิล — staff propose → owner attach slip on บช.เจ้าของ → accept once
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/bill-notices.ts");
const panel = read("src/components/BillNoticeLedgerPanel.tsx");
const ledger = read("src/app/ledger/page.tsx");
const ownerBooksPage = read("src/app/owner-books/page.tsx");
const storage = read("storage.rules");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const labels = read("src/lib/ledger-labels.ts");
const ownerBooks = read("src/lib/owner-books.ts");
const ownerAi = read("src/lib/owner-books-ai.ts");

assert.match(version, /APP_BUILD\s*=\s*\d+/);
assert.ok(existsSync(join(root, "src/lib/bill-notices.ts")));
assert.ok(existsSync(join(root, "src/components/BillNoticeLedgerPanel.tsx")));

assert.match(ledger, /BillNoticeLedgerPanel/);
assert.match(ledger, /billNoticeForceOpen|billNotice=1/);
assert.match(ownerBooksPage, /BillNoticeLedgerPanel/);
assert.match(ownerBooksPage, /variant="owner"/);
assert.match(ownerBooksPage, /searchParams\.get\("billNotice"\)\s*===\s*"1"/);

assert.match(panel, /export function BillNoticeLedgerPanel/);
assert.match(panel, /variant\?: "ledger" \| "owner"/);
assert.match(panel, /BillNoticeSlipModal/);
assert.match(panel, /setBillNoticePaymentSlips/);
assert.match(panel, /แนบสลิป/);
assert.match(panel, /ไปรับ/);
assert.match(panel, /extractOwnerBookFromReceipt/);
assert.match(panel, /BILL_NOTICE_PRESETS/);
assert.match(panel, /SheetDateCell ms=\{row\.date\} era="be"/);
assert.match(css, /Phase 3 table layout/);
assert.match(css, /\.bill-notice-slim \.col-date/);
assert.match(css, /\.bill-notice-slim \.col-slip/);
assert.match(css, /\.bill-notice-slim \.col-out[\s\S]*?overflow:\s*visible/);
assert.match(css, /\.ledger-ops-duo\b/);
assert.match(ledger, /ledger-ops-duo/);

assert.match(lib, /export async function addBillNotice/);
assert.match(lib, /export async function acceptBillNotice/);
assert.match(lib, /export async function rejectBillNotice/);
assert.match(lib, /export async function setBillNoticePaymentSlips/);
assert.match(lib, /isBillNoticeReadyForOwnerBooks/);
assert.match(lib, /isBillNoticeBillReady/);
assert.match(lib, /getBillNoticePaymentSlipUrls/);
assert.match(lib, /paymentSlipUrls/);
assert.match(lib, /ต้องแนบสลิปชำระก่อนรับเข้าตารางหลัก/);
assert.match(lib, /รอชำระ/);
assert.match(lib, /เข้าบัญชี/);
assert.match(lib, /summarizeBillNotices/);
assert.match(lib, /addOwnerBookEntry/);
assert.match(lib, /status: "pending"/);
assert.match(lib, /"accepted"/);

assert.match(ownerBooks, /export async function addOwnerBookEntry/);
assert.match(ownerAi, /extractOwnerBookFromReceipt/);

assert.match(storage, /match \/bill-notices\//);
assert.match(css, /\.bill-notice-panel\b/);
assert.match(css, /\.bill-notice-panel\.is-owner-books\b/);
assert.match(css, /\.bill-notice-summary\b/);
assert.match(css, /\.bill-notice-slim\b/);
assert.match(css, /\.bill-notice-act-row\b/);

assert.match(labels, /"ค่าน้ำ"/);
assert.match(labels, /"ค่าแก๊ส"/);

console.log("OK test-bill-notices-ledger");
