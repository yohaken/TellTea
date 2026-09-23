/**
 * Production photo QA — fail-closed on AI outage + wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const qa = read("src/lib/prod-photo-qa.ts");
assert.match(qa, /PROD_PHOTO_QA_TIMEOUT_MS = 55_000/);
assert.match(qa, /void callPromise\.catch/);
assert.match(qa, /confirmKind: "ai_unavailable"/);
assert.match(qa, /staffConfirmedPhotoMatch/);
assert.match(qa, /verifyStatus: "pending"/);
assert.match(qa, /ai_batch_outage|ai_outage/);

const prod = read("src/lib/production.ts");
assert.match(prod, /s === "flagged" \|\| s === "pending"/);

const confirm = read("src/components/ProdPhotoQaConfirm.tsx");
assert.match(confirm, /ai_unavailable/);
assert.match(confirm, /ยืนยัน — รูปตรงกับ/);
assert.match(confirm, /ต้องยืนยันรูปกับสินค้า/);

const page = read("src/app/production/page.tsx");
assert.match(page, /kind=\{pendingConflict\.kind\}/);
assert.match(page, /staffConfirmedPhotoMatch: true/);
assert.match(page, /รอยืนยัน/);
// Persist before clearing dialog
assert.match(page, /await persistEntry\(payload, photoQa\);\s*\n\s*setPendingConflict\(null\)/);

const cf = read("functions/verify-prod-photo-conflict.js");
assert.match(cf, /verifyProdPhotoConflict/);
assert.match(cf, /meta\/aiSettings/);

console.log("ok: prod-photo-qa fail-closed + confirm");
