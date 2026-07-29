/**
 * Gate: BO sessions smart table — search · multi-check · bulk delete except keep pairing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 418/);

const admin = read("src/lib/pos-sales-admin.ts");
assert.match(admin, /export async function deletePosSessionsAdmin/);
assert.match(admin, /sessionId.*in/);
assert.match(admin, /POS_SESSIONS_COL|posSessions/);
assert.match(admin, /POS_SALES_COL|posSales/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /deletePosSessionsAdmin/);
assert.match(slim, /selectedIds|setSelectedIds/);
assert.match(slim, /toggleSelectAllVisible/);
assert.match(slim, /selectNonKeepVisible/);
assert.match(slim, /NPOS_SHOP_KEEP_PAIRING_CODE|570F0F/);
assert.match(slim, /เลือกที่ไม่ใช่/);
assert.match(slim, /ลบที่เลือก/);
assert.match(slim, /npos-slim-check-col/);
assert.match(slim, /npos-slim-search|table-search/);
assert.match(slim, /useDeferredValue/);
assert.match(slim, /PosConfirmDialog/);
assert.match(slim, /destructive/);
assert.match(slim, /bulk-status-toolbar/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-check-col/);
assert.match(css, /\.npos-slim-bulk-delete/);
assert.match(css, /\.npos-slim-row\.is-bulk-selected/);
assert.match(css, /minmax\(1\.35rem,\s*max-content\)/);

console.log("ok: npos-bo-sessions-bulk-delete gate");
