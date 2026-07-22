/**
 * nPos diagnose report wiring — native → Cloud Function → back-office fold.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 224/);
assert.match(read("docs/npos-migration-phases.md"), /N1/);
assert.match(read("docs/npos-migration-phases.md"), /nposDiagnose/);
assert.match(read("functions/npos-diagnose.js"), /reportNposDiagnose/);
assert.match(read("functions/index.js"), /reportNposDiagnose/);
assert.match(read("firestore.rules"), /match \/nposDiagnose\/\{installId\}/);
assert.match(read("scripts/assert-firestore-rules.mjs"), /nposDiagnose/);
assert.match(read("src/lib/npos-diagnose.ts"), /subscribeNposDiagnoseReports/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /SettingsFold/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /ตรวจเครื่อง \(nPos\)/);
assert.match(read("src/components/PosManagePanel.tsx"), /NposDiagnosePanel/);
assert.doesNotMatch(read("src/components/PosManagePanel.tsx"), /ยังไม่มีรายการจัดการ/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+19/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DiagnoseReporter.java"),
  /reportNposDiagnose/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/DiagnoseActivity.java"),
  /sendReport|DiagnoseReporter/,
);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /diagnose_report/);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DiagnoseReporter.java")));

console.log("OK test-npos-diagnose");
