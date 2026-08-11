/**
 * Rendered Sunmi slip → BO gallery (role=slip).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/SlipCaptureUpload.java"),
  ),
);
const upload = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/SlipCaptureUpload.java",
);
assert.match(upload, /uploadPrintedSlip/);
assert.match(upload, /"slip"/);
assert.match(upload, /reportNposScreenCapture|REPORT_URL/);

const sunmi = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(sunmi, /SlipCaptureUpload\.uploadPrintedSlip/);
assert.match(sunmi, /releaseService\(\)/);
assert.match(sunmi, /printedOk/);

const capture = read("functions/npos-capture.js");
assert.match(capture, /slipMeta|body\.slip/);
assert.match(capture, /latestSlipUrl/);
assert.match(capture, /saveJpeg\(installId, "slip"/);
assert.match(capture, /isSlipOnly/);

const media = read("functions/npos-capture-media.js");
assert.match(media, /normalizeCaptureRole/);
assert.match(media, /r === "slip"|role === "slip"/);

const mediaTs = read("src/lib/npos-capture-media.ts");
assert.match(mediaTs, /NposCaptureRole/);
assert.match(mediaTs, /"slip"/);

const diag = read("src/lib/npos-diagnose.ts");
assert.match(diag, /latestSlipUrl/);
assert.match(diag, /latestSlipId/);

const devices = read("src/lib/pos-devices.ts");
assert.match(devices, /latestSlipUrl/);

const gallery = read("src/components/NposCaptureGallery.tsx");
assert.match(gallery, /slipUrl/);
assert.match(gallery, /สลิป/);

const panel = read("src/components/NposDevicesPanel.tsx");
assert.match(panel, /slipUrl/);
assert.match(panel, /ขาย 1 บิลจะได้สลิป|สลิปล่าสุด|สลิป/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 149);

const pin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(pin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 149);

const whats = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java",
);
assert.match(whats, /versionCode == 149/);
assert.match(whats, /ส่งภาพสลิปกลับหลังร้าน/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 773);

console.log("OK test-npos-slip-capture");
