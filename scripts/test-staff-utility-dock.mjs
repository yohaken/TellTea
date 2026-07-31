/**
 * Staff utility dock — left FAB (staff only) + /utility/ module for BOH.
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
const panel = read("src/components/StaffUtilityPanel.tsx");
const page = read("src/app/utility/page.tsx");
const more = read("src/app/more/page.tsx");
const suggestions = read("src/lib/staff-suggestions.ts");
const utility = read("src/lib/staff-utility.ts");
const css = read("src/app/globals.css");
const rules = read("firestore.rules");
const assertRules = read("scripts/assert-firestore-rules.mjs");

assert.match(version, /APP_BUILD = 525/);
assert.match(shell, /StaffUtilityDock/);
assert.match(shell, /\/utility/);
assert.match(dock, /staff-utility-fab/);
assert.match(dock, /is-attention/);
assert.match(dock, /!isOwner/);
assert.match(dock, /closePanel/);
assert.match(dock, /setOpen\(false\)/);
assert.match(dock, /StaffUtilityPanel/);
assert.doesNotMatch(dock, /role === "owner"[^\n]*return/);
assert.match(panel, /createStaffSuggestion/);
assert.match(panel, /STAFF_UTILITY_CATALOG/);
assert.match(page, /StaffUtilityPanel/);
assert.match(page, /embedded/);
assert.match(more, /href="\/utility\/"/);
assert.match(more, /ยูทิลิตี้/);
assert.match(utility, /suggestions/);
assert.match(utility, /tasks/);
assert.match(suggestions, /staffSuggestions/);
assert.match(css, /\.staff-utility-fab/);
assert.match(css, /top:\s*50%/);
assert.match(css, /translateY\(-50%\)/);
assert.match(rules, /match \/staffSuggestions\/\{id\}/);
assert.match(assertRules, /staffSuggestions/);

console.log("test-staff-utility-dock: ok");
