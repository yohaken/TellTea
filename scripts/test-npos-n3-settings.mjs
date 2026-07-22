/**
 * nPos N3 — settings layout + customer display + stableKey dedupe.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 214/);
assert.match(read("docs/npos-migration-phases.md"), /N3.*✅|✅ รอบนี้ \(1\.8\.0\)/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+10/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.8\.0"/);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceIdentity.java"),
  /ANDROID_ID|stableKey/,
);
assert.match(read("functions/npos-heartbeat.js"), /stableKey/);
assert.match(read("functions/npos-heartbeat.js"), /disabled:\s*true|disabled = true|disabled: true/);
assert.match(read("src/lib/pos-devices.ts"), /stableKey/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /dedupeNposDevices|stableKey/);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"),
  /SettingsActivity/,
);
assert.match(
  read("npos-telltea/app/src/main/AndroidManifest.xml"),
  /SettingsActivity/,
);
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java"),
  ),
);
assert.ok(
  existsSync(
    join(
      root,
      "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerAmountPresentation.java",
    ),
  ),
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java"),
  /CustomerAmountPresentation|showCustomerAmount/,
);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /btn_customer_amount_1/);

console.log("OK test-npos-n3-settings");
