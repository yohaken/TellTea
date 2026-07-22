/**
 * nPos D1 display specs + C1/C2 screen capture wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 240/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+33/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.10"/);
assert.match(read("docs/npos-capture-checklist.md"), /สั่งแคปจอ|C1|C4|50/);
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

assert.match(read("functions/npos-capture.js"), /getSignedUrl|captureMediaUrl/);
assert.match(read("functions/npos-capture.js"), /media proxy|captureMediaUrl/);
assert.match(read("functions/npos-capture-media.js"), /nposCaptureMedia/);
assert.match(read("functions/index.js"), /nposCaptureMedia/);
assert.match(read("src/lib/npos-capture-media.ts"), /resolveNposCaptureDisplayUrl/);
assert.match(read("src/lib/npos-diagnose.ts"), /orderBy\("updatedAt"/);
assert.match(read("src/lib/pos-devices.ts"), /latestPrimaryUrl/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /resolveNposCaptureDisplayUrl|capturesForUi/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /resolveNposCaptureDisplayUrl/);
assert.match(read("src/components/NposCaptureTimelinePanel.tsx"), /resolveNposCaptureDisplayUrl/);
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
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /live_customer|captureLiveCustomerOrNull/,
);
assert.ok(existsSync(join(root, "scripts/smoke-npos-capture-image.mjs")));

/* C1–C4: clear-all, full-res display, retain ≤50, Android full-res capture */
assert.ok(existsSync(join(root, "functions/npos-capture-prune.js")));
assert.match(read("functions/npos-capture-prune.js"), /MAX_SHOTS_PER_INSTALL\s*=\s*50/);
assert.match(read("functions/npos-capture-prune.js"), /clearAllNposShots|clearNposShotsForInstall/);
assert.match(read("functions/npos-capture.js"), /pruneNposShotsForInstall/);
assert.match(read("functions/npos-capture.js"), /MAX_B64\s*=\s*6_000_000|6000000/);
assert.match(read("functions/npos-owner-device.js"), /clear_captures/);
assert.match(read("functions/npos-owner-device.js"), /clear_captures_all/);
assert.match(read("src/lib/pos-devices.ts"), /clearNposDeviceCaptures|clearAllNposCaptures/);
assert.match(read("src/lib/npos-screen-shots.ts"), /NPOS_CAPTURE_MAX_KEEP\s*=\s*50/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /ล้างภาพแคป|clearNposDeviceCaptures/);
assert.match(read("src/components/NposCaptureTimelinePanel.tsx"), /ล้างรูปเคลียร์ทั้งหมด|clearAllNposCaptures/);
assert.match(read("src/app/globals.css"), /object-fit:\s*contain/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /MAX_EDGE\s*=\s*1920/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java"),
  /JPEG_QUALITY\s*=\s*88/,
);
assert.match(read("docs/npos-shop-work-checklist.md"), /C1|C4|P4/);
assert.match(read("docs/npos-remaining-checklist.md"), /C1|C4|P4/);

console.log("OK test-npos-capture");
