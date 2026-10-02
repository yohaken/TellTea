/**
 * Ledger owner organize tools: status column, select / select all, date range,
 * bulk AI + set type, closed VAT month confirm, audit. Staff see labels only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const libSrc = read("src/lib/ledger.ts");
const aiSrc = read("src/lib/ledger-ai.ts");
const auditSrc = read("src/lib/ledger-audit.ts");
const closedSrc = read("src/lib/ledger-closed-months.ts");
const toolsSrc = read("src/components/LedgerOrganizeTools.tsx");
const pageSrc = read("src/app/ledger/page.tsx");
const settingsSrc = read("src/components/LedgerAiSettingsPanel.tsx");
const versionSrc = read("src/lib/version.ts");

// Data layer
assert.match(libSrc, /export async function bulkUpdateLedgerTypes/);
assert.match(libSrc, /LEDGER_OUT_TYPES\s*=\s*\["cogs", "sga", "asset", "อื่นๆ"\]/);
assert.match(libSrc, /ประเภทไม่ถูกต้อง/);
assert.match(libSrc, /typeUpdatedAt/);
assert.match(libSrc, /export async function loadLedgerRange/);
assert.match(libSrc, /T00:00:00\+07:00/);
assert.match(aiSrc, /export async function reclassifyLedgerRowsWithAi/);
assert.match(aiSrc, /prevSource === "owner"/);
assert.match(aiSrc, /startsWith\("payroll"\)/);
assert.match(aiSrc, /shouldCancel/);
assert.match(auditSrc, /LEDGER_AUDIT_COL = "ledgerAudit"/);
assert.match(auditSrc, /closedMonthOverride/);
assert.match(closedSrc, /status === "filed"/);
assert.match(closedSrc, /bangkokMonthKey/);
assert.doesNotMatch(closedSrc, /catch/);

// Status labels
for (const label of ["AI", "จัดเอง", "เดา", "ว่าง"]) {
  assert.ok(toolsSrc.includes(`label: "${label}"`), `status label ${label}`);
}

// Owner-only gate (perm preview off)
assert.match(pageSrc, /const canOrganize = isOwner && !isPermPreview/);
for (const marker of [
  "bulk-check-col",
  "ledger-bulk-compact",
  "<LedgerRangePicker",
  "col-status-ai-btn",
  "เลือกเฉพาะ เดา/ว่าง",
]) {
  const idx = pageSrc.indexOf(marker);
  assert.ok(idx > 0, `missing ${marker}`);
  const before = pageSrc.slice(Math.max(0, idx - 2000), idx);
  assert.match(before, /canOrganize/, `${marker} must sit behind canOrganize`);
}
assert.match(pageSrc, /selectableRows = useMemo[\s\S]{0,80}canOrganize \?/);
assert.match(pageSrc, /<LedgerStatusBadge row=\{row\} \/>/);

// Closed month confirm on bulk + single edit, audit everywhere
assert.match(pageSrc, /confirmClosedMonths\(\s*rows,/);
assert.match(pageSrc, /getFiledMonths\(\[ledgerMonthKey\(entry\.date\)\]\)/);
assert.match(pageSrc, /action: "bulk_set_type"/);
assert.match(pageSrc, /action: "ai_reclassify"/);
assert.match(pageSrc, /action: "edit_type"/);
assert.match(pageSrc, /LedgerClosedMonthDialog/);

// Backfill moved to range tools (no hardcoded month)
assert.doesNotMatch(settingsSrc, /BACKFILL_MONTH|reclassifyLedgerMonthWithAi/);

// Type colors + instant cell update (AI per row, bulk set, edit modal)
const labelsSrc = read("src/lib/ledger-labels.ts");
const cssSrc = read("src/app/globals.css");
assert.match(labelsSrc, /export function ledgerTypeColorKey/);
assert.match(pageSrc, /is-type-\$\{ledgerTypeColorKey\(row\.type\)\}/);
for (const k of ["cogs", "sga", "other", "in"]) {
  assert.match(cssSrc, new RegExp(`\\.col-type\\.is-type-${k} \\{`));
}
assert.match(aiSrc, /opts\?\.onRowChanged\?\.\(change\)/);
assert.match(pageSrc, /onRowChanged: \(c\) =>\s*patchRowsLocal/);
assert.match(pageSrc, /if \(patch\) patchRowsLocal/);

// Normal save paths still classify with AI (add + edit)
const addModalSrc = read("src/components/LedgerAddOutModal.tsx");
assert.match(addModalSrc, /await classifyLedgerTypeWithAi\(description\)/);
assert.match(pageSrc, /await classifyLedgerTypeWithAi\(description\)/);
const fnSrc = read("functions/classify-ledger.js");
assert.match(fnSrc, /responseSchema: RESPONSE_SCHEMA/);
assert.match(fnSrc, /callGeminiWithRetry\(/);

// popup บันทึก: ประเภทคงที่ (AI / ต้นทุน / ค่าใช้จ่าย / สินทรัพย์) — ไม่มี อื่นๆ · ไม่พิมพ์เอง · ไม่ดึงจากประวัติ
assert.match(labelsSrc, /SAVE_TYPE_OPTIONS = \["auto", "cogs", "sga", "asset"\] as const/);
const pickerSrc = read("src/components/TypePicker.tsx");
assert.match(pickerSrc, /SAVE_TYPE_OPTIONS\.map/);
assert.doesNotMatch(pickerSrc, /<input|frequent|ใช้ «/);
for (const f of ["src/components/LedgerTypeField.tsx", "src/components/LedgerAddOutModal.tsx", "src/app/owner-books/page.tsx", "src/app/ledger/page.tsx"]) {
  assert.doesNotMatch(read(f), /frequent=\{|typeFreq/, `${f}: no history type chips`);
}

assert.match(pageSrc, /ledger-table-search/);
assert.match(pageSrc, /ledger-staff-sheet/);
assert.ok(Number(versionSrc.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 1067);

console.log("OK test-ledger-bulk-retype-owner");
