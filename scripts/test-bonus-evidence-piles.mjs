/**
 * Guard: bonus evidence caution + cut piles + forced view order.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/bonus-deductions.ts");
const panel = read("src/components/BonusDeductionEvidencePanel.tsx");
const page = read("src/app/bonus/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*541/);
assert.match(lib, /cautionUrls/);
assert.match(lib, /cautionNote/);
assert.match(lib, /export type BonusEvidencePileId/);
assert.match(lib, /export function bonusEvidenceViewOrder/);
assert.match(lib, /saveBonusDeductionMonthEvidence/);

function bonusEvidencePileHasContent(doc, pile) {
  if (pile === "caution") {
    return doc.cautionUrls.length > 0 || Boolean(doc.cautionNote.trim());
  }
  return doc.evidenceUrls.length > 0 || Boolean(doc.note.trim());
}

function bonusEvidenceViewOrder(doc) {
  const order = [];
  if (bonusEvidencePileHasContent(doc, "caution")) order.push("caution");
  if (bonusEvidencePileHasContent(doc, "cut")) order.push("cut");
  return order;
}

assert.deepEqual(
  bonusEvidenceViewOrder({
    cautionUrls: ["a"],
    cautionNote: "",
    evidenceUrls: ["b"],
    note: "",
  }),
  ["caution", "cut"],
);
assert.deepEqual(
  bonusEvidenceViewOrder({
    cautionUrls: [],
    cautionNote: "",
    evidenceUrls: ["b"],
    note: "cut only",
  }),
  ["cut"],
);
assert.deepEqual(
  bonusEvidenceViewOrder({
    cautionUrls: [],
    cautionNote: "watch",
    evidenceUrls: [],
    note: "",
  }),
  ["caution"],
);

assert.match(panel, /1 · ระวัง/);
assert.match(panel, /2 · ตัด/);
assert.match(panel, /BonusEvidenceForcedViewer/);
assert.match(panel, /เริ่มดู · ระวังก่อน แล้วตัด/);
assert.match(page, /BonusDeductionEvidencePanel/);
assert.match(page, /actorId=\{actorId/);

console.log("OK test-bonus-evidence-piles");
