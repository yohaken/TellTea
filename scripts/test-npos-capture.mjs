/**
 * nPos D1 display specs + C1/C2 screen capture wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 223/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+18/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.12\.0"/);
assert.match(read("docs/npos-capture-checklist.md"), /สั่งแคปจอ/);
assert.match(read("docs/npos-pilot-gate-faq.md"), /แคปจอ/);

const probe = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DisplayProbe.java",
);
assert.match(probe, /widthPx/);
assert.match(probe, /orientation/);
assert.match(probe, /densityDpi/);
assert.match(probe, /customerDisplayStatus/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java")),
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /reportNposScreenCapture/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /PixelCopy/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"),
  /handleCaptureCommand|capture/,
);
assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /NposApp/);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java")));

assert.match(read("functions/npos-capture.js"), /reportNposScreenCapture/);
assert.match(read("functions/npos-capture.js"), /nposScreenShots/);
assert.match(read("functions/npos-capture.js"), /npos-screenshots/);
assert.match(read("functions/index.js"), /reportNposScreenCapture/);
assert.match(read("functions/npos-heartbeat.js"), /captureRequestAt|capture:/);
assert.match(read("functions/npos-diagnose.js"), /widthPx/);
assert.match(read("functions/npos-diagnose.js"), /orientation/);

assert.match(read("firestore.rules"), /nposScreenShots/);
assert.match(read("firestore.rules"), /captureRequestAt/);
assert.match(read("firestore.rules"), /captureIntervalMinutes/);
assert.match(read("scripts/assert-firestore-rules.mjs"), /nposScreenShots/);

assert.match(read("src/lib/pos-devices.ts"), /requestNposScreenCapture/);
assert.match(read("src/lib/pos-devices.ts"), /setNposCaptureInterval/);
assert.match(read("src/lib/npos-diagnose.ts"), /latestPrimaryUrl/);
assert.match(read("src/lib/npos-diagnose.ts"), /widthPx/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /สั่งแคปจอ/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /captureIntervalMinutes|ทุก/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /npos-capture-thumbs|latestPrimaryUrl/);
assert.match(read("src/app/globals.css"), /npos-capture-thumbs/);

console.log("OK test-npos-capture");
