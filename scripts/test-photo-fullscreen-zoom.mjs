/**
 * Fullscreen photo viewer: pinch-zoom, swipe between images, max-quality src.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const viewer = readFileSync(join(root, "src/components/EntryPhotoCell.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const ledger = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");

assert.match(viewer, /photo-fs-root/);
assert.match(viewer, /photo-fs-img/);
assert.match(viewer, /MAX_SCALE/);
assert.match(viewer, /onPointerDown/);
assert.match(viewer, /pinchStart/);
assert.match(viewer, /SWIPE_PX/);
assert.match(viewer, /DISMISS_DY/);
assert.match(viewer, /onClose\(\)/);
assert.match(viewer, /ปัดลงปิด|ปัดลงเพื่อปิด/);
assert.match(viewer, /dismissY/);
assert.match(viewer, /resolveEvidencePhotoSrcList/);
assert.match(viewer, /กำลังโหลดรูปคุณภาพสูง/);
assert.match(viewer, /onDownloadAll/);
assert.match(viewer, /บันทึกทุกรูป/);
assert.match(css, /\.photo-fs-root\b/);
assert.match(css, /\.photo-fs-img\b/);
assert.match(css, /touch-action:\s*none/);
assert.match(ledger, /ImagePreviewModal/);

console.log("OK test-photo-fullscreen-zoom");
