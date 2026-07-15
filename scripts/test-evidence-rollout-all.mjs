/**
 * Guard: every evidence photo surface wires the latest multi `evp:` / storageFolder pattern.
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
const staffInfo = read("src/components/StaffPersonalInfoModal.tsx");
const multi = read("src/components/PhotoAttachMultiField.tsx");
const evidence = read("src/lib/evidence-photos.ts");
const photoUpload = read("src/lib/photo-upload.ts");
const checklistLib = read("src/lib/checklist.ts");
const productionLib = read("src/lib/production.ts");
const staffPersonalLib = read("src/lib/staff-personal.ts");
const taskLogic = read("src/lib/task-weekly-logic.ts");
const profileLib = read("src/lib/profile.ts");
const readiness = read("src/lib/staff-readiness.ts");

assert.match(multi, /uploadEvidencePhotos/);
assert.match(evidence, /EVIDENCE_PHOTO_PREFIX\s*=\s*"evp:"/);
assert.match(photoUpload, /saveEvidencePhotoDoc/);

assert.match(ownerBooks, /PhotoAttachMultiField/);
assert.match(ownerBooks, /storageFolder="owner-books"/);
assert.match(ledger, /storageFolder="ledger-receipts"/);
assert.match(ledger, /uploadEvidencePhotos/);
assert.match(ledger, /handleRowPhotoFiles/);
assert.doesNotMatch(ledger, /อยากแนบหลายรูป — เปิดรายการ/);
assert.match(transferIn, /PhotoAttachMultiField/);
assert.match(transferIn, /storageFolder="ledger-receipts"/);
assert.match(ot, /PhotoAttachMultiField/);
assert.match(ot, /storageFolder="ot-photos"/);
assert.doesNotMatch(ot, /uploadOtProductPhoto/);
assert.doesNotMatch(ot, /uploadFile=/);

assert.match(check, /PhotoAttachMultiField/);
assert.match(check, /storageFolder="checklist"/);
assert.match(check, /CHECK_IMAGE_MAX/);
assert.match(check, /imageUrls/);
assert.doesNotMatch(check, /PhotoAttachField/);

assert.match(tasks, /PhotoAttachMultiField/);
assert.match(tasks, /storageFolder="tasks"/);
assert.match(tasks, /TASK_PROOF_MAX/);
assert.match(tasks, /proofImgs/);
assert.doesNotMatch(tasks, /PhotoAttachField/);

assert.match(production, /PhotoAttachMultiField/);
assert.match(production, /storageFolder="production"/);
assert.match(production, /PROD_IMAGE_MAX/);
assert.match(production, /imageUrls/);
assert.doesNotMatch(production, /PhotoAttachField/);

assert.match(profile, /PhotoAttachMultiField/);
assert.match(profile, /storageFolder="staff-id"/);
assert.match(profile, /STAFF_ID_CARD_MAX/);
assert.match(profile, /idCardPhotoUrls/);
assert.doesNotMatch(profile, /PhotoAttachField/);

assert.match(personal, /PhotoAttachMultiField/);
assert.match(personal, /storageFolder="staff-id"/);
assert.match(personal, /idCardPhotoUrls/);
assert.doesNotMatch(personal, /PhotoAttachField/);

assert.match(staffInfo, /getIdCardPhotoUrls/);
assert.match(staffInfo, /ImagePreviewModal/);

assert.match(checklistLib, /export const CHECK_IMAGE_MAX/);
assert.match(checklistLib, /getChecklistImageUrls/);
assert.match(productionLib, /export const PROD_IMAGE_MAX/);
assert.match(productionLib, /getProdImageUrls/);
assert.match(staffPersonalLib, /export const STAFF_ID_CARD_MAX/);
assert.match(staffPersonalLib, /getIdCardPhotoUrls/);
assert.match(taskLogic, /export const TASK_PROOF_MAX/);
assert.match(taskLogic, /getTaskProofImgs/);
assert.match(profileLib, /getIdCardPhotoUrls/);
assert.match(readiness, /getIdCardPhotoUrls/);

const rules = read("firestore.rules");
assert.match(rules, /'proofImgs'/);
assert.match(rules, /match \/evidencePhotos\/\{photoId\}/);

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
    "staff-info-modal",
  ],
  multiEverywhere: true,
});
