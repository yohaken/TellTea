/**
 * Photo forensics + shared entry timestamps (P1–P3 light).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const metaLib = read("src/lib/image-capture-meta.ts");
const evidence = read("src/lib/evidence-photos.ts");
const entryMeta = read("src/components/EntryTimestampsMeta.tsx");
const preview = read("src/components/EntryPhotoCell.tsx");
const attach = read("src/components/PhotoAttachMultiField.tsx");
const prod = read("src/app/production/page.tsx");
const ot = read("src/app/ot/page.tsx");
const owner = read("src/app/owner-books/page.tsx");
const ledger = read("src/app/ledger/page.tsx");
const checklist = read("docs/photo-forensics-checklist.md");
const version = read("src/lib/version.ts");

assert.match(metaLib, /extractImageCaptureMeta/);
assert.match(metaLib, /readJpegExifDateMs/);
assert.match(metaLib, /photoDateMismatchHint/);
assert.match(evidence, /extractImageCaptureMeta/);
assert.match(evidence, /capturedAt/);
assert.match(evidence, /contentHash/);
assert.match(evidence, /getEvidencePhotoMeta/);
assert.match(entryMeta, /EntryTimestampsMeta/);
assert.match(preview, /showCaptureMeta/);
assert.match(preview, /photo-fs-capture-meta/);
assert.match(attach, /ถ่าย/);
assert.doesNotMatch(attach, /พร้อมอัปโหลด \(ออนไลน์\)/);
assert.match(prod, /EntryTimestampsMeta/);
assert.match(prod, /showCaptureMeta=\{isOwner\}/);
assert.match(ot, /EntryTimestampsMeta/);
assert.match(ot, /showCaptureMeta=\{isOwner\}/);
assert.match(owner, /EntryTimestampsMeta/);
assert.match(ledger, /EntryTimestampsMeta/);
assert.match(checklist, /Phase 2/);
assert.match(version, /APP_BUILD\s*=\s*271/);

console.log("OK test-photo-forensics-meta");
