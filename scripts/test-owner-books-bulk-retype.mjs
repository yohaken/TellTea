/**
 * Owner-books: multi-select + bulk retype (upsert type).
 * Static wiring check + optional live Firestore round-trip when credentials exist.
 *
 * Live upsert (restore after):
 *   APPLY=1 FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/test-owner-books-bulk-retype.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libSrc = readFileSync(join(root, "src/lib/owner-books.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(libSrc, /export async function bulkUpdateOwnerBookTypes/);
assert.match(libSrc, /typeSource:\s*"owner"/);
assert.match(libSrc, /writeBatch\(db\)/);
assert.match(pageSrc, /bulkUpdateOwnerBookTypes/);
assert.match(pageSrc, /selectedIds/);
assert.match(pageSrc, /onBulkRetype/);
assert.match(pageSrc, /BULK_TYPE_OPTIONS/);
assert.match(pageSrc, /bulk-check-col/);
assert.match(pageSrc, /เลือกที่แสดง/);
assert.match(cssSrc, /is-bulk-selected/);
assert.match(versionSrc, /APP_BUILD\s*=\s*225/);

console.log("OK static test-owner-books-bulk-retype");

const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const rawCred = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;

if (!rawCred || !String(rawCred).trim().startsWith("{")) {
  console.log("skip live upsert (no FIREBASE_SERVICE_ACCOUNT)");
  process.exit(0);
}

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(rawCred)), projectId: PROJECT });
}
const db = getFirestore();

const snap = await db.collection("ownerBooks").orderBy("createdAt", "desc").limit(3).get();
assert.ok(snap.size >= 1, "need ≥1 ownerBooks row for live upsert");

const docs = snap.docs.map((d) => {
  const data = d.data() || {};
  return {
    id: d.id,
    type: String(data.type || ""),
    typeSource: String(data.typeSource || ""),
    typeAiReason: String(data.typeAiReason || ""),
  };
});

const probeType = docs[0].type === "sga" ? "cogs" : "sga";
console.log(
  `live upsert probe → ${probeType} on ${docs.length} ids:`,
  docs.map((d) => d.id).join(", "),
);

if (!APPLY) {
  console.log("dry-run only (set APPLY=1 to write+restore)");
  process.exit(0);
}

const now = Date.now();
const batch = db.batch();
for (const d of docs) {
  batch.update(db.collection("ownerBooks").doc(d.id), {
    type: probeType,
    typeSource: "owner",
    typeAiReason: "",
    updatedAt: now,
  });
}
await batch.commit();

for (const d of docs) {
  const after = await db.collection("ownerBooks").doc(d.id).get();
  assert.equal(after.data()?.type, probeType);
  assert.equal(after.data()?.typeSource, "owner");
}

const restore = db.batch();
const restoreAt = Date.now();
for (const d of docs) {
  restore.update(db.collection("ownerBooks").doc(d.id), {
    type: d.type,
    typeSource: d.typeSource,
    typeAiReason: d.typeAiReason,
    updatedAt: restoreAt,
  });
}
await restore.commit();

console.log("OK live upsert + restore");
