/**
 * nPos N4–N5 printer/drawer + ops log pipeline.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 248/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+39/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.16"/);
assert.match(read("docs/npos-migration-phases.md"), /N4.*✅|✅ รอบนี้ \(1\.8\.0\)/);
assert.match(read("docs/npos-migration-phases.md"), /N5.*✅|✅ รอบนี้ \(1\.8\.0\)/);
assert.match(read("docs/npos-migration-phases.md"), /ทำไม POS web|แผนโคนราก/);

assert.match(read("functions/npos-ops-log.js"), /reportNposOpsLog/);
assert.match(read("functions/index.js"), /reportNposOpsLog/);
assert.match(read("firestore.rules"), /nposOpsLog/);
assert.match(read("scripts/assert-firestore-rules.mjs"), /nposOpsLog/);
assert.match(read("src/lib/npos-ops-log.ts"), /subscribeNposOpsLogs/);
assert.match(read("src/components/NposOpsLogPanel.tsx"), /ไทม์ไลน์ nPos/);
assert.match(read("src/components/PosManagePanel.tsx"), /NposOpsLogPanel/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/OpsLogger.java")),
);
assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java")),
);
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterTransport.java"),
  ),
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java"),
  /runPrinterTest|runDrawerKick|OpsLogger/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"),
  /printerReady/,
);
assert.match(read("functions/npos-heartbeat.js"), /printerReady/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /btn_printer_test/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /btn_drawer_kick/);

assert.match(read("src/components/NposOpsLogPanel.tsx"), /npos-ops-detail/);

console.log("OK test-npos-n4-n5-ops-log");
