/**
 * Guard: TellTea firestore.rules — slim shop model (signed-in can work).
 *
 * Sibling apps on mypeer-501909 must NOT deploy their own rules file.
 * Canonical rules live ONLY in this repo. See firestore.rules.full.bak for archive.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rulesPath = join(root, "firestore.rules");
const firebasePath = join(root, "firebase.json");

assert.ok(existsSync(rulesPath), "missing firestore.rules");
const rules = readFileSync(rulesPath, "utf8");
const lines = rules.split("\n").length;
const firebase = JSON.parse(readFileSync(firebasePath, "utf8"));

assert.equal(
  firebase.firestore?.rules,
  "firestore.rules",
  "firebase.json must point firestore.rules at this repo file",
);

assert.ok(
  lines <= 55,
  `firestore.rules too long (${lines} lines) — keep slim shop model ≤50`,
);
assert.ok(lines >= 20, `firestore.rules suspiciously short (${lines} lines)`);

assert.match(rules, /function signedIn\(/);
assert.match(rules, /request\.auth != null/);
assert.match(rules, /yohaken@gmail\.com/);
assert.match(rules, /match \/loginTickets\/\{ticketId\}/);
assert.match(rules, /match \/taxtag\/\{uid\}/);
assert.match(rules, /match \/userData\/\{userId\}/);
assert.match(rules, /collection != 'taxtag'/);
assert.match(rules, /collection != 'userData'/);
assert.match(
  rules,
  /Canonical Firestore rules|Sibling apps|firestore\.rules\.full\.bak|TaxTag/i,
);

// Deny-all wipe pattern (sibling accident)
assert.doesNotMatch(
  rules,
  /match \/\{document=\*\*\}[\s\S]{0,80}allow read, write: if false/,
  "must not be a deny-all wipe ruleset",
);

const templatePath = join(root, "scripts/templates/firebase.hosting-only.json");
assert.ok(existsSync(templatePath), "missing scripts/templates/firebase.hosting-only.json");
const template = JSON.parse(readFileSync(templatePath, "utf8"));
assert.equal(
  template.firestore,
  undefined,
  "hosting-only template must NOT include firestore (prevents accidental rules wipe)",
);
assert.ok(template.hosting, "hosting-only template needs hosting");

console.log(`OK firestore-rules guard · slim · ${lines} lines · shop signedIn + sibling own-uid`);
