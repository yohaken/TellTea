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
  "cashDeposits",
  "billNotices",
  "ownerBooks",
  "evidencePhotos",
  "monthlyIncome",
  "stock",
  "stockCosts",
  "employees",
  "employeePay",
  "payrollItems",
  "bonusLivePool",
  "bonusMonthCloses",
  "bonusMonthStatus",
  "bonusPersonalCloses",
  "prodEntries",
  "otEntries",
  "checklistRecords",
  "staffSuggestions",
  "meta",
  "loginTickets",
  "posSales",
  "posDevices",
  "nposDiagnose",
  "nposOpsLog",
  "nposScreenShots",
  "menuItems",
  "dailySales",
  "platformEmailReports",
  "vatMonthCloses",
  "vatMonthlyReturns",
  "vatInputInvoices",
  "vatSalesAudit",
  "vatAgentChat",
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
assert.match(rules, /function canReadEmployeePay\(/);
assert.match(rules, /match \/bonusMonthStatus\/\{monthId\}/);
assert.match(rules, /match \/bonusPersonalCloses\/\{id\}/);
assert.match(
  rules,
  /match \/bonusMonthCloses\/\{monthId\}[\s\S]*?allow read: if isOwner\(\) \|\| isOwnerEmail\(\) \|\| hasPerm\('payrollPay'\)/,
);
assert.match(rules, /function staffHubUpdateOk\(/);
assert.match(rules, /payrollPay/);
assert.match(rules, /yohaken@gmail\.com/);
// ledger: staff cannot freely update/delete all rows
assert.match(rules, /resource\.data\.createdBy == actorId\(\)/);
assert.match(rules, /resource\.data\.amountIn == 0/);
// payrollItems: self-scoped get for bonus staff
assert.match(rules, /resource\.data\.employeeId == staffEmployeeId\(\)/);
assert.match(rules, /match \/stockCosts\/\{itemId\}/);
assert.match(rules, /match \/bonusLivePool\/\{monthKey\}/);
assert.match(rules, /canReadBonusEntry/);
// get ต้องคู่ list — hasPerm(perm) ไม่จำกัด workerIds (ลงยอดย้อนหลัง)
assert.match(
  rules,
  /function canReadBonusEntry\(perm\) \{[\s\S]*?hasPerm\(perm\);/,
);
assert.match(
  rules,
  /Never deploy a Tax-only firestore\.rules|Canonical Firestore rules|TaxTag/,
);

// VAT / daily sales — owner-only + light write validation
assert.match(rules, /match \/dailySales\/\{dateId\}/);
assert.match(rules, /match \/vatMonthlyReturns\/\{monthId\}/);
assert.match(rules, /request\.resource\.data\.dateKey == dateId/);
assert.match(rules, /vatMonthlyReturns\/\{monthId\}[\s\S]*?isOwner\(\) \|\| isOwnerEmail\(\)/);
assert.match(rules, /vatSalesSettings' && isOwner\(\)/);
assert.match(rules, /vatImportAiNotes' && isOwner\(\)/);
assert.match(rules, /vatDeliverySourceNotes' && isOwner\(\)/);
assert.match(rules, /vatMailStudyNotes' && isOwner\(\)/);
assert.match(rules, /vatAgentApi' && isOwner\(\)/);
assert.match(rules, /vatDeliveryFreshStart' && isOwner\(\)/);
assert.match(rules, /match \/vatAgentChat\/\{msgId\}/);
assert.match(rules, /vatAgentChatPresence'/);


assert.match(rules, /vatMonthlySettings' && \(isOwner\(\) \|\| isOwnerEmail\(\)\)/);
assert.match(rules, /personalTaxSettings' && \(isOwner\(\) \|\| isOwnerEmail\(\)\)/);
assert.match(rules, /vatMailOAuth' && isOwner\(\)/);
assert.doesNotMatch(
  rules,
  /PERMISSION_KEYS|ownerBooks.*vat|vatSales.*hasPerm/,
  "VAT must not be grantable via permissions",
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
