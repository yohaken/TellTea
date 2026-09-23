/**
 * Production photo QA — owner tools only in form; staff never see AI/flag buttons.
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
assert.match(qa, /buildOwnerManualFlagPhotoQa/);
assert.match(qa, /prodPhotoQaBadgeLabel/);
assert.match(qa, /ตรวจอีกครั้ง/);
assert.match(qa, /prodPhotoQaBadgeTitle/);
assert.match(qa, /ให้ตรวจสอบรายการอีกครั้ง/);
assert.match(qa, /runOwnerEntryPhotoQaCheck/);
assert.match(qa, /flaggedBy: "ai_owner"/);

const prod = read("src/lib/production.ts");
assert.match(prod, /s === "flagged" \|\| s === "pending"/);

const confirm = read("src/components/ProdPhotoQaConfirm.tsx");
assert.match(confirm, /ai_unavailable/);
assert.match(confirm, /is-slim/);
assert.match(confirm, /ตรง ·/);

const page = read("src/app/production/page.tsx");
assert.match(page, /kind=\{pendingConflict\.kind\}/);
assert.match(page, /staffConfirmedPhotoMatch: true/);
assert.match(page, /ติดป้ายมือ/);
assert.match(page, /ตรวจ AI/);
assert.match(page, /runOwnerEntryPhotoQaCheck/);
assert.match(page, /prodPhotoQaBadgeTitle/);
assert.match(page, /ให้ตรวจสอบรายการอีกครั้ง/);
assert.match(page, /isOwner && entry && !locked/);
assert.match(page, /prod-photo-qa-owner-actions/);
assert.match(page, /is-prod-form/);
assert.match(page, /prod-form-body/);
assert.match(page, /prod-entry-form/);
assert.match(page, /prod-form-product/);
assert.match(page, /prod-form-date/);
assert.match(page, /await persistEntry\(payload, photoQa\);\s*\n\s*setPendingConflict\(null\)/);
// Toolbar batch scan: owner only
assert.match(page, /\{isOwner && showLog && !pageLoading \? \(/);
assert.match(page, /ProdPhotoQaBatchPanel/);
// No table-row AI / flag / clear buttons
assert.doesNotMatch(page, /onOwnerAiCheck/);
assert.doesNotMatch(page, /onOwnerFlag/);
assert.doesNotMatch(page, /onOwnerClearFlag/);
assert.doesNotMatch(page, /prod-qa-row-btn/);
assert.doesNotMatch(page, />\s*AI\s*</);
// Staff photo hint has no AI wording
assert.match(page, /บังคับ ≥1 รูปสดจากกล้อง/);

const batch = read("src/components/ProdPhotoQaBatchPanel.tsx");
assert.match(batch, /ติดป้ายที่เลือก/);
assert.match(batch, /buildOwnerManualFlagPhotoQa/);
assert.match(batch, /เจ้าของสแกน AI/);

const css = read("src/app/globals.css");
assert.match(css, /is-prod-form/);
assert.match(css, /prod-form-card/);
assert.match(css, /prod-photo-qa-confirm\.is-slim/);

const cf = read("functions/verify-prod-photo-conflict.js");
assert.match(cf, /verifyProdPhotoConflict/);
assert.match(cf, /meta\/aiSettings/);

console.log("ok: prod-photo-qa owner-only tools; no table AI/flag buttons");
