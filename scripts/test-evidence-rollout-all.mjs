/**
 * Guard: every evidence photo surface wires the latest `evp:` / storageFolder pattern.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const ownerBooks = read("src/app/owner-books/page.tsx");
const ledger = read("src/app/ledger/page.tsx");
const transferIn = read("src/app/in/page.tsx");
const ot = read("src/app/ot/page.tsx");
const check = read("src/app/check/page.tsx");
const tasks = read("src/app/tasks/page.tsx");
const production = read("src/app/production/page.tsx");
const profile = read("src/app/profile/page.tsx");
const personal = read("src/components/PersonalProfileModal.tsx");
const multi = read("src/components/PhotoAttachMultiField.tsx");
const single = read("src/components/PhotoAttachField.tsx");
const evidence = read("src/lib/evidence-photos.ts");
const photoUpload = read("src/lib/photo-upload.ts");

assert.match(multi, /uploadEvidencePhotos/);
assert.match(single, /uploadEvidencePhotos/);
assert.match(single, /storageFolder/);
assert.match(evidence, /EVIDENCE_PHOTO_PREFIX\s*=\s*"evp:"/);
assert.match(photoUpload, /saveEvidencePhotoDoc/);

assert.match(ownerBooks, /storageFolder="owner-books"/);
assert.match(ledger, /storageFolder="ledger-receipts"/);
assert.match(ledger, /uploadEvidencePhotos/);
assert.match(transferIn, /storageFolder="ledger-receipts"/);
assert.match(ot, /storageFolder="ot-photos"/);
assert.doesNotMatch(ot, /uploadOtProductPhoto/);
assert.doesNotMatch(ot, /uploadFile=/);
assert.match(check, /storageFolder="checklist"/);
assert.match(tasks, /storageFolder="tasks"/);
assert.match(production, /storageFolder="production"/);
assert.match(profile, /storageFolder="staff-id"/);
assert.match(personal, /storageFolder="staff-id"/);

// Edit ledger uses edit slot key
assert.match(ledger, /storageSlotKey=\{`edit-\$\{entry\.id\}`\}/);

console.log("OK test-evidence-rollout-all", {
  surfaces: [
    "owner-books",
    "ledger",
    "in",
    "ot",
    "check",
    "tasks",
    "production",
    "profile",
    "personal-modal",
  ],
});
