/**
 * Gate: MediaProjection capture + nag-until-grant consent (BO / after update).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 549/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 160/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+127/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.104"/);

assert.ok(existsSync(join(root, "docs/npos-capture-projection-checklist.md")));
const doc = read("docs/npos-capture-projection-checklist.md");
assert.match(doc, /1.14.104/);
assert.match(doc, /MediaProjection/);
assert.match(doc, /acquireLatestImage|thread แยก|no_usable_frame/);

const manifest = read("npos-telltea/app/src/main/AndroidManifest.xml");
assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
assert.match(manifest, /CaptureConsentActivity/);
assert.match(manifest, /CaptureProjectionService/);
assert.match(manifest, /foregroundServiceType="mediaProjection"/);

for (const rel of [
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureConsentActivity.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionService.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionPrefs.java",
]) {
  assert.ok(existsSync(join(root, rel)), rel);
}

const capture = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java",
);
assert.match(capture, /MediaProjection|CaptureProjectionService/);
assert.match(capture, /grabPrimary/);
assert.match(capture, /isMostlyBrandGreen/);
assert.match(capture, /shouldAutoPrompt|CaptureConsentActivity/);
assert.match(capture, /draw_decor|drawDecorBitmap/);
// Older tablets must not dead-end on PixelCopy-only API.
assert.doesNotMatch(capture, /return CaptureShot\.fail\("api_lt_26"\)/);
// Ack only when hasImages — empty report must retry via heartbeat.
assert.match(capture, /if \(hasImages\)[\s\S]*setLastAckRequestAt/);
assert.match(capture, /จะลองใหม่/);
assert.doesNotMatch(capture, /statusShot\(/);
assert.doesNotMatch(
  capture,
  /Always produce a small JPEG so BO still gets a visible frame/,
);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionPrefs.java",
);
assert.match(prefs, /markPromptAfterUpdate/);
assert.match(prefs, /shouldAutoPrompt/);
assert.match(prefs, /markNagUntilGrant|shouldNagUntilGrant/);
assert.match(prefs, /markProjectionDead/);
assert.match(prefs, /6L \* 60L \* 60L/); // interval-only throttle

const proj = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionService.java",
);
assert.match(proj, /isMostlyBlackOrEmpty/);
assert.match(proj, /no_usable_frame|markProjectionDead/);
assert.match(proj, /acquireLatestImage/);
assert.match(proj, /npos-vd-grab|new Thread/);
assert.match(proj, /VIRTUAL_DISPLAY_FLAG_PUBLIC/);

const consent = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureConsentActivity.java",
);
assert.match(consent, /RETRY_AFTER_DENY_MS/);
assert.match(consent, /scheduleRetry|relaunchPendingIfNeeded/);
assert.match(consent, /พนักงานไม่รับสิทธิ์/);
assert.match(consent, /SHOWING/);
assert.match(consent, /hasLiveProjection/);

const cf = read("functions/npos-capture.js");
assert.match(cf, /hasImages/);
assert.match(cf, /lastCaptureFailAt|lastCaptureFailDetail/);
assert.match(cf, /\.\.\.\(hasImages/);

const media = read("src/lib/npos-capture-media.ts");
assert.match(media, /if \(!stored\) return ""/);
assert.match(media, /Never invent a proxy URL|storedUrl/);

const capPrefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CapturePrefs.java",
);
assert.match(capPrefs, /hasOutstandingCaptureRequest/);
assert.match(capPrefs, /setPendingConsent/);

const install = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/InstallResultReceiver.java",
);
assert.match(install, /CaptureProjectionPrefs\.markPromptAfterUpdate/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /CaptureConsentActivity\.launchAfterUpdateIfNeeded/);
assert.match(main, /CaptureConsentActivity\.relaunchPendingIfNeeded/);
const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /CaptureConsentActivity\.launchAfterUpdateIfNeeded/);
assert.match(sell, /CaptureConsentActivity\.relaunchPendingIfNeeded/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-capture-projection-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /capture-projection/);

console.log("OK test-npos-capture-projection");
