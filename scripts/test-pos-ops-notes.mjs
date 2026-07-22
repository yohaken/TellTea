/**
 * POS ops notes — install links on POS host only; cut from counter nav.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*70\b/);
assert.match(read("src/lib/pos-ops-notes.ts"), /posOpsNotes/);
assert.match(read("src/lib/pos-ops-notes.ts"), /defaultPosOpsNoteItems/);
assert.match(read("src/lib/pos-ops-notes.ts"), /POS_APK_INSTALL_PAGE_URL/);
const nav = read("src/lib/pos-nav.ts");
assert.doesNotMatch(nav, /id: "ops"/);
assert.doesNotMatch(nav, /ลิงก์จากร้าน/);
assert.match(read("src/components/PosOpsNotesSetup.tsx"), /ไม่ต้องแชร์รหัสอีเมลร้าน/);
assert.match(read("src/components/PosOpsNotesView.tsx"), /subscribePosOpsNotes/);
assert.match(read("src/components/PosOpsNotesView.tsx"), /isPosInstallUrl|telltea-pos\.web\.app/);
assert.match(read("src/app/pos/ops/page.tsx"), /PosOpsNotesView/);
assert.match(read("src/app/pos-sales/page.tsx"), /PosSalesReportPage/);
assert.doesNotMatch(read("src/components/PosManagePanel.tsx"), /PosOpsNotesSetup/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /ไม่ต้องรู้รหัสอีเมลร้าน/);
assert.doesNotMatch(read("src/app/settings/page.tsx"), /PosOpsNotesSetup/);
assert.doesNotMatch(read("src/app/settings/page.tsx"), /PosDeviceSetup/);
assert.match(read("firestore.rules"), /posOpsNotes/);

console.log("test-pos-ops-notes: ok");
