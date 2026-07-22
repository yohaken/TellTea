/**
 * nPos D1 display specs + C1/C2 screen capture wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 231/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+24/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.1"/);
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


assert.match(read("functions/index.js"), /nposOwnerDeviceCommand/);
assert.match(read("functions/npos-owner-device.js"), /nposOwnerDeviceCommand/);
assert.match(read("functions/npos-owner-device.js"), /assertOwner/);
assert.match(read("src/lib/pos-devices.ts"), /nposOwnerDeviceCommand/);
assert.match(read("src/lib/pos-devices.ts"), /callNposOwnerDeviceCommand/);
assert.match(read("firestore.rules"), /isOwnerEmail\(\)\) && posDeviceOwnerPatch/);
assert.match(read("firestore.rules"), /allow list: if isOwner\(\) \|\| isOwnerEmail\(\)/);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/PermissionBootstrap.java")));
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/PermissionBootstrap.java"), /grantAll/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /PermissionBootstrap/);
assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /POST_NOTIFICATIONS/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /btn_grant_all_perms/);
assert.match(read("functions/npos-heartbeat.js"), /permissionsOk|permissionsStatus/);


assert.match(read("functions/storage-bucket.js"), /resolveStorageBucket/);
assert.match(read("functions/npos-capture.js"), /resolveStorageBucket/);
assert.match(read("functions/npos-capture.js"), /appspot|resolveStorageBucket/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"), /Do NOT ack|requestCapture/);
assert.doesNotMatch(read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"), /setLastAckRequestAt\(app, requestAt\);\s*\n\s*ScreenCapture/);
assert.match(read("src/components/NposCaptureGallery.tsx"), /ImagePreviewModal/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /NposCaptureGallery/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /NposCaptureGallery/);
assert.match(read("docs/npos-remaining-checklist.md"), /Local DB first|โคลนผัง/);
assert.match(read(".github/workflows/deploy.yml"), /RESOLVED_STORAGE_BUCKET|ensure-storage-bucket/);

assert.match(read("functions/npos-capture.js"), /getSignedUrl/);
assert.match(read("functions/npos-capture.js"), /signed URL failed|falling back to media token/);
assert.match(read("src/lib/npos-diagnose.ts"), /orderBy\("updatedAt"/);
assert.match(read("src/lib/pos-devices.ts"), /latestPrimaryUrl/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /capturesForUi|latestPrimaryUrl/);
assert.match(read("src/components/NposCaptureGallery.tsx"), /onError/);
assert.match(read("src/components/NposCaptureTimelinePanel.tsx"), /ไทม์ไลน์แคปจอ/);
assert.match(read("src/components/PosManagePanel.tsx"), /NposCaptureTimelinePanel/);
assert.match(read("src/lib/npos-screen-shots.ts"), /nposScreenShots/);
assert.match(read("src/components/NposOpsLogPanel.tsx"), /npos-ops-detail/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /hasImages/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /แคปจอไม่มีรูปบนเซิร์ฟเวอร์/,
);

console.log("OK test-npos-capture");
