/**
 * Staff utility dock — left FAB + suggestions + tasks scaffold blink.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const shell = read("src/components/AppShell.tsx");
const dock = read("src/components/StaffUtilityDock.tsx");
const suggestions = read("src/lib/staff-suggestions.ts");
const utility = read("src/lib/staff-utility.ts");
const css = read("src/app/globals.css");
const rules = read("firestore.rules");
const assertRules = read("scripts/assert-firestore-rules.mjs");

assert.match(version, /APP_BUILD = 403/);
assert.match(shell, /StaffUtilityDock/);
assert.match(dock, /staff-utility-fab/);
assert.match(dock, /is-attention/);
assert.match(dock, /subscribeTaskOccurrencesForAssignee/);
assert.match(dock, /createStaffSuggestion/);
assert.match(dock, /STAFF_UTILITY_CATALOG/);
assert.match(utility, /suggestions/);
assert.match(utility, /tasks/);
assert.match(utility, /staffUtilityAttentionCount/);
assert.match(suggestions, /staffSuggestions/);
assert.match(suggestions, /accepted/);
assert.match(suggestions, /later/);
assert.match(css, /\.staff-utility-fab/);
assert.match(css, /staff-utility-blink/);
assert.match(rules, /match \/staffSuggestions\/\{id\}/);
assert.match(rules, /staffSuggestionCreate/);
assert.match(assertRules, /staffSuggestions/);

console.log("test-staff-utility-dock: ok");
