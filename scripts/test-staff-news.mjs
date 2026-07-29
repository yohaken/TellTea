/**
 * Staff news popup + owner note warehouse — smoke assertions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD\s*=\s*380\b/);
assert.match(read("src/lib/staff-news.ts"), /STAFF_NEWS_DOC\s*=\s*"staffNews"/);
assert.match(read("src/lib/staff-news.ts"), /announcedStaffNews/);
assert.match(read("src/lib/staff-news.ts"), /staffNewsAnnounceFingerprint/);
assert.match(read("src/lib/staff-news.ts"), /inWarehouse/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /sessionStorage/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /ขยายอ่าน/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /แจ้งข่าวสาร/);
assert.match(read("src/components/StaffNewsSetup.tsx"), /เอาออกจากแจ้ง/);
assert.match(read("src/components/StaffNewsSetup.tsx"), /คลังโนต/);
assert.match(read("src/components/AppShell.tsx"), /StaffNewsPopup/);
assert.match(read("src/app/settings/page.tsx"), /StaffNewsSetup/);
assert.match(read("src/app/globals.css"), /\.staff-news-float\b/);
// meta/staffNews uses existing meta rules: staff read + owner write
assert.match(read("firestore.rules"), /match \/meta\/\{docId\}/);
assert.match(read("firestore.rules"), /allow write: if isOwner\(\)/);

console.log("test-staff-news: ok");
