/**
 * Delete open tasks must succeed even when taskTemplates doc is already gone
 * (Firestore "No document to update" must not block occurrence deletes).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const occ = read("src/lib/task-occurrences.ts");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = \d+/);
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 563);
assert.match(occ, /sanitizeTaskTemplateId/);
assert.match(occ, /resolveExistingTaskTemplateRef/);
assert.match(occ, /commitOpenOccurrenceDeletes/);
assert.match(occ, /getDoc/);
assert.match(occ, /No document to update/);
assert.match(occ, /templateExists|resolveExistingTaskTemplateRef/);

function sanitizeTaskTemplateId(raw) {
  return String(raw || "")
    .trim()
    .split(/[?#]/)[0]
    .trim();
}

assert.equal(sanitizeTaskTemplateId("M3xz?rue"), "M3xz");
assert.equal(sanitizeTaskTemplateId("M3xzTrue"), "M3xzTrue");
assert.equal(sanitizeTaskTemplateId(" abc#x "), "abc");

function isOpen(status) {
  return status === "pending" || status === "missed" || status === "waiting";
}

function collectOpen(templateId, occurrences) {
  const tid = sanitizeTaskTemplateId(templateId);
  const rawTid = String(templateId || "").trim();
  const matchTid = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return false;
    if (rawTid && t === rawTid) return true;
    if (tid && (t === tid || sanitizeTaskTemplateId(t) === tid)) return true;
    return false;
  };
  const open = occurrences.filter((o) => matchTid(o.templateId) && isOpen(o.status));
  const keys = new Set(open.map((o) => o.periodKey));
  const byId = new Map();
  for (const o of occurrences) {
    if (!matchTid(o.templateId)) continue;
    if (o.status === "completed") continue;
    if (keys.has(o.periodKey) || isOpen(o.status)) byId.set(o.id, o);
  }
  return [...byId.values()];
}

const rows = [
  { id: "a", templateId: "M3xz?rue", periodKey: "2026-08-01", status: "pending" },
  { id: "b", templateId: "M3xz", periodKey: "2026-08-01", status: "pending" },
  { id: "c", templateId: "other", periodKey: "2026-08-01", status: "pending" },
];
const open = collectOpen("M3xz?rue", rows);
assert.equal(open.length, 2);
assert.deepEqual(open.map((o) => o.id).sort(), ["a", "b"]);

console.log("test-tasks-delete-missing-template: ok");
