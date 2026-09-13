/**
 * Staff news popup + owner note warehouse — smoke assertions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD\s*=\s*947\b/);
assert.match(read("src/lib/staff-news.ts"), /STAFF_NEWS_DOC\s*=\s*"staffNews"/);
assert.match(read("src/lib/staff-news.ts"), /announcedStaffNews/);
assert.match(read("src/lib/staff-news.ts"), /staffNewsAnnounceFingerprint/);
assert.match(read("src/lib/staff-news.ts"), /inWarehouse/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /sessionStorage/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /ขยายอ่าน/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /แจ้งข่าวสาร/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /staff-news-fab/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /หุบ/);
assert.match(read("src/components/StaffNewsPopup.tsx"), /telltea_staff_news_collapsed_v1/);
assert.doesNotMatch(read("src/components/StaffNewsPopup.tsx"), /telltea_staff_news_dismissed_v1/);
assert.match(read("src/components/StaffNewsSetup.tsx"), /เอาออกจากแจ้ง/);
assert.match(read("src/components/StaffNewsSetup.tsx"), /คลังโนต/);
assert.match(read("src/components/AppShell.tsx"), /StaffNewsPopup/);
assert.match(read("src/app/settings/page.tsx"), /StaffNewsSetup/);
assert.match(read("src/app/globals.css"), /\.staff-news-float\b/);
assert.match(read("src/app/globals.css"), /\.staff-news-fab\b/);
assert.match(read("src/app/globals.css"), /top: calc\(4\.85rem \+ var\(--safe-top/);
assert.match(read("src/app/globals.css"), /staff-task-nudge-strip[\s\S]*?bottom: calc\(var\(--nav-h\) \+ var\(--safe-bottom\)/);
assert.doesNotMatch(
  read("src/app/globals.css"),
  /\.staff-news-float\s*\{[^}]*bottom:\s*calc\(4\.6rem/s,
);
// shop catch-all: signed-in can read/write meta/staffNews (UI gates owner write)
assert.match(read("firestore.rules"), /match \/\{collection\}\/\{document=\*\*\}/);
assert.match(read("firestore.rules"), /allow read, write: if signedIn\(\)/);

console.log("test-staff-news: ok");
