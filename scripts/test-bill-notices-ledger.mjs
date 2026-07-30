/**
 * Guard: ตารางแจ้งบิล — staff propose utility bills → owner merge to บช.เจ้าของ
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
const rules = read("firestore.rules");
const storage = read("storage.rules");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const labels = read("src/lib/ledger-labels.ts");
const assertRules = read("scripts/assert-firestore-rules.mjs");
const ownerBooks = read("src/lib/owner-books.ts");
const ownerAi = read("src/lib/owner-books-ai.ts");

assert.match(version, /APP_BUILD\s*=\s*\d+/);
assert.ok(existsSync(join(root, "src/lib/bill-notices.ts")));
assert.ok(existsSync(join(root, "src/components/BillNoticeLedgerPanel.tsx")));

assert.match(ledger, /BillNoticeLedgerPanel/);
assert.match(ledger, /billNoticeForceOpen|billNotice=1/);
assert.match(ledger, /ledger-staff-toolbar/);
assert.match(ledger, /ledger-table-search/);
assert.match(ledger, /ledger-balance-over-in/);
assert.match(read("src/app/ledger/bill-notices/page.tsx"), /billNotice=1/);

assert.match(panel, /export function BillNoticeLedgerPanel/);
assert.match(panel, /extractOwnerBookFromReceipt/);
assert.match(panel, /aiAssist/);
assert.match(panel, /AI อ่านรูปให้อัตโนมัติ/);
assert.match(panel, /อ่านจากรูปอีกครั้ง/);
assert.match(panel, /runExtractFromPhotos/);
assert.match(panel, /วันที่/);
assert.match(panel, /รายการ/);
assert.match(panel, />บิล</);
assert.match(panel, />ออก</);
assert.match(panel, /note/);
assert.match(panel, /วิเคราะห์สรุป|bill-notice-summary/);
assert.match(panel, /bill-notice-line/);
assert.match(panel, /shortLabelBillNoticeStatus/);
assert.match(panel, /bill-notice-act-row/);
assert.match(panel, /BILL_NOTICE_PRESETS/);
assert.match(panel, /SheetDateCell ms=\{row\.date\} era="be"/);
assert.match(panel, /era="be"/);
assert.match(css, /Phase 3 table layout/);
assert.match(css, /\.bill-notice-slim \.col-date/);
assert.match(css, /width: 3\.55rem/);
assert.match(version, /APP_BUILD\s*=\s*475/);

assert.match(lib, /export async function addBillNotice/);
assert.match(lib, /export async function acceptBillNotice/);
assert.match(lib, /export async function rejectBillNotice/);
assert.match(lib, /isBillNoticeReadyForOwnerBooks/);
assert.match(lib, /summarizeBillNotices/);
assert.match(lib, /shortLabelBillNoticeStatus/);
assert.match(lib, /billNoticeBucketLabel/);
assert.match(lib, /orderBy\("createdAt", "desc"\)/);
assert.match(lib, /addOwnerBookEntry/);
assert.match(lib, /status: "pending"/);
assert.match(lib, /"accepted"/);

assert.match(ownerBooks, /export async function addOwnerBookEntry/);
assert.match(ownerAi, /extractOwnerBookFromReceipt/);

assert.match(rules, /match \/billNotices\/\{entryId\}/);
assert.match(rules, /request\.resource\.data\.status == 'pending'/);
assert.match(assertRules, /"billNotices"/);

assert.match(storage, /match \/bill-notices\//);
assert.match(css, /\.bill-notice-panel\b/);
assert.match(css, /\.bill-notice-summary\b/);
assert.match(css, /\.bill-notice-slim\b/);
assert.match(css, /\.bill-notice-line\b/);
assert.match(css, /white-space:\s*nowrap/);
assert.match(css, /\.bill-notice-act-row\b/);
assert.match(css, /\.ledger-staff-toolbar\b/);
assert.match(css, /flex:\s*0\s+0\s+30%/);
assert.match(css, /\.bill-notice-ai-toggle\b/);

assert.match(labels, /"ค่าน้ำ"/);
assert.match(labels, /"ค่าแก๊ส"/);

console.log("OK test-bill-notices-ledger");
