/**
 * Guard: TellTea firestore.rules must stay complete before any firebase deploy.
 *
 * Why: sibling apps on the same project (e.g. TaxTag / taxtag.web.app) once
 * deployed a tiny rules file and wiped ledger/staff/POS access for the shop.
 *
 * Canonical rules live ONLY in this repo. Sibling apps must deploy hosting only.
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
const firebase = JSON.parse(readFileSync(firebasePath, "utf8"));

assert.equal(
  firebase.firestore?.rules,
  "firestore.rules",
  "firebase.json must point firestore.rules at this repo file",
);

/** Core TellTea / POS paths — if any go missing, shop breaks. */
const REQUIRED_MATCHES = [
  "staff",
  "staffPhones",
  "ledger",
  "ownerBooks",
  "evidencePhotos",
  "monthlyIncome",
  "stock",
  "employees",
  "prodEntries",
  "otEntries",
  "checklistRecords",
  "meta",
  "loginTickets",
  "posSales",
  "posDevices",
  "menuItems",
];

/** Sibling apps that share mypeer-501909 — keep their collections here too. */
const SHARED_APP_MATCHES = [
  // https://taxtag.web.app — collection taxtag/{uid}
  "taxtag",
];

const matchNames = [...rules.matchAll(/match\s+\/([A-Za-z0-9_]+)\/\{/g)].map((m) => m[1]);
const unique = new Set(matchNames);

assert.ok(
  matchNames.length >= 20,
  `firestore.rules looks too small (${matchNames.length} top-level matches) — possible wipe/overwrite`,
);

for (const name of REQUIRED_MATCHES) {
  assert.ok(unique.has(name), `missing required match /${name}/{…} in firestore.rules`);
}

for (const name of SHARED_APP_MATCHES) {
  assert.ok(
    unique.has(name),
    `missing shared-app match /${name}/{…} — add rules in TellTea before sibling hosting uses it`,
  );
}

assert.match(rules, /function isStaff\(/);
assert.match(rules, /function hasPerm\(/);
assert.match(rules, /yohaken@gmail\.com/);
assert.match(
  rules,
  /Never deploy a Tax-only firestore\.rules|Canonical Firestore rules|TaxTag/,
);

// Sibling template must stay hosting-only (no firestore key) so copy-paste is safe.
const templatePath = join(root, "scripts/templates/firebase.hosting-only.json");
assert.ok(existsSync(templatePath), "missing scripts/templates/firebase.hosting-only.json");
const template = JSON.parse(readFileSync(templatePath, "utf8"));
assert.equal(
  template.firestore,
  undefined,
  "hosting-only template must NOT include firestore (prevents accidental rules wipe)",
);
assert.ok(template.hosting, "hosting-only template needs hosting");

console.log(
  `OK firestore-rules guard · ${unique.size} collections · shared apps: ${SHARED_APP_MATCHES.join(", ")}`,
);
