/**
 * Guard: bonus evidence caution + cut piles + forced accept since 2026-09.
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

assert.match(version, /APP_BUILD\s*=\s*\d+/);
assert.match(lib, /cautionUrls/);
assert.match(lib, /BONUS_EVIDENCE_FORCE_SINCE\s*=\s*"2026-09"/);
assert.match(lib, /writeBonusEvidenceAccepted/);
assert.match(lib, /shouldForceBonusEvidenceMonth/);
assert.match(lib, /listBonusEvidenceForceMonths/);
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

function shouldForce(ym, since = "2026-09") {
  return ym >= since;
}

function listMonths(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

assert.equal(shouldForce("2026-08"), false);
assert.equal(shouldForce("2026-09"), true);
assert.equal(shouldForce("2026-10"), true);
assert.deepEqual(listMonths("2026-09", "2026-11"), [
  "2026-09",
  "2026-10",
  "2026-11",
]);

assert.deepEqual(
  bonusEvidenceViewOrder({
    cautionUrls: ["a"],
    cautionNote: "",
    evidenceUrls: ["b"],
    note: "",
  }),
  ["caution", "cut"],
);

assert.match(lib, /export function forcedSlideAdvance/);
assert.match(lib, /export function forcedSlideAcceptReady/);

/** Mirror lib: ไปต่อได้ทีละใบเท่านั้น */
function forcedSlideAdvance(idx, slideCount, maxReached) {
  if (slideCount <= 0) return null;
  if (idx < 0 || idx > maxReached || idx >= slideCount) return null;
  if (idx >= slideCount - 1) {
    return { idx, maxReached: Math.max(maxReached, idx), atEnd: true };
  }
  const next = idx + 1;
  return {
    idx: next,
    maxReached: Math.max(maxReached, next),
    atEnd: next >= slideCount - 1,
  };
}

function forcedSlideAcceptReady(idx, slideCount, maxReached) {
  if (slideCount <= 0) return false;
  return idx === slideCount - 1 && maxReached >= slideCount - 1;
}

assert.equal(forcedSlideAdvance(0, 3, 0)?.idx, 1);
assert.equal(forcedSlideAdvance(0, 3, 0)?.maxReached, 1);
assert.equal(forcedSlideAdvance(1, 3, 1)?.idx, 2);
assert.equal(forcedSlideAdvance(2, 3, 2)?.atEnd, true);
assert.equal(forcedSlideAdvance(0, 3, -1), null);
assert.equal(forcedSlideAdvance(5, 3, 2), null);
assert.equal(forcedSlideAcceptReady(0, 3, 0), false);
assert.equal(forcedSlideAcceptReady(1, 3, 2), false);
assert.equal(forcedSlideAcceptReady(2, 3, 2), true);
assert.equal(forcedSlideAcceptReady(0, 1, 0), true);

let cursor = 0;
let reached = 0;
for (let i = 0; i < 4; i++) {
  const step = forcedSlideAdvance(cursor, 4, reached);
  assert.ok(step);
  cursor = step.idx;
  reached = step.maxReached;
}
assert.equal(cursor, 3);
assert.equal(reached, 3);
assert.equal(forcedSlideAcceptReady(cursor, 4, reached), true);

assert.match(panel, /1 · ระวัง/);
assert.match(panel, /2 · ตัด/);
assert.match(panel, /BonusEvidenceForcedViewer/);
assert.match(panel, /บังคับดูทีละรูป/);
assert.match(panel, /maxReached/);
assert.match(panel, /forcedSlideAdvance/);
assert.match(panel, /ข้ามไม่ได้/);
assert.match(panel, /พร้อมปรับปรุงและยอมรับ/);
assert.match(panel, /writeBonusEvidenceAccepted|onAccepted/);
assert.match(panel, /locked/);
assert.match(page, /BonusDeductionEvidencePanel/);
assert.match(page, /actorId=\{actorId/);

console.log("OK test-bonus-evidence-piles");
