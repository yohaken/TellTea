import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  fingerprintDistance,
  imageFingerprint,
  inspectImageBytes,
  liveIdInSrc,
  MAX_AHASH_DISTANCE,
  shopeeImageUrls,
  verifyDisplayedPhoto,
} from "./lib/channel-photo-verify.mjs";

assert.equal(liveIdInSrc("th-11134505-81zti-abc", ["https://down-bs-th.img.susercontent.com/th-11134505-81zti-abc.webp"]), true);
assert.equal(liveIdInSrc("menueditor_item_96ee1f0efd934408b59aa14c79eb4342_1788.jpeg", ["https://food-cms.grab.com/x/96ee1f0efd934408b59aa14c79eb4342.webp"]), true);
assert.equal(liveIdInSrc("ff93686ab1be.jpg", ["https://lmwn-img.line-scdn.net/p/400x0/2026/09/06/ff93686ab1be.jpg"]), true);
assert.equal(liveIdInSrc("th-new", ["https://down-bs-th.img.susercontent.com/th-old.webp"]), false);
assert.ok(shopeeImageUrls("th-11134505-x").some((u) => u.includes("th-11134505-x")));

function patternJpeg(width, height, paint) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, g, b] = paint(x, y, width, height);
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

const cocoa = await patternJpeg(480, 480, (x, y) => [40, y > 220 ? 90 : 40, x > 200 ? 50 : 20]);
const cocoaTwin = await patternJpeg(720, 720, (x, y) => [40, y > 330 ? 90 : 40, x > 300 ? 50 : 20]);
const pearl = await patternJpeg(480, 480, (x, y) => [210, 170, x > 240 ? 80 : 20]);

const tiny = await inspectImageBytes(Buffer.from("not-an-image"));
assert.equal(tiny.ok, false);
const okImg = await inspectImageBytes(cocoa);
assert.equal(okImg.ok, true);
assert.equal(okImg.width, 480);

const same = fingerprintDistance(await imageFingerprint(cocoa), await imageFingerprint(cocoaTwin));
const diff = fingerprintDistance(await imageFingerprint(cocoa), await imageFingerprint(pearl));
assert.ok(same <= MAX_AHASH_DISTANCE, `same-color resize distance ${same}`);
assert.ok(diff > MAX_AHASH_DISTANCE, `different-color distance ${diff}`);

const pass = await verifyDisplayedPhoto({
  posBuf: cocoa,
  livePhotoId: "th-live",
  pageImgSrcs: ["https://cdn.example/th-live.webp"],
  extraUrls: [],
  liveImageUrl: undefined,
});
assert.equal(pass.reasons.includes("no-page-img"), false);
assert.ok(pass.reasons.some((r) => r.startsWith("cdn:")), "cdn fetch required");

const noPage = await verifyDisplayedPhoto({
  posBuf: cocoa,
  livePhotoId: "th-live",
  pageImgSrcs: [],
});
assert.equal(noPage.ok, false);
assert.ok(noPage.reasons.includes("no-page-img"));

const mismatch = await verifyDisplayedPhoto({
  posBuf: cocoa,
  livePhotoId: "th-new",
  pageImgSrcs: ["https://cdn.example/th-old.webp"],
});
assert.equal(mismatch.ok, false);
assert.ok(mismatch.reasons.includes("page-img-mismatch"));

const inspectDir = join(dirname(fileURLToPath(import.meta.url)), "data/menu-price-baseline/channel-photo-verify");
const cocoaPos = join(inspectDir, "cocoa-pos.jpg");
if (existsSync(cocoaPos)) {
  const pos = readFileSync(cocoaPos);
  for (const name of ["cocoa-shopee-cdn.jpg", "cocoa-grab-cdn.jpg", "cocoa-line-cdn.jpg"]) {
    const p = join(inspectDir, name);
    if (!existsSync(p)) continue;
    const d = fingerprintDistance(await imageFingerprint(pos), await imageFingerprint(readFileSync(p)));
    assert.ok(d <= MAX_AHASH_DISTANCE, `${name} vs POS d=${d}`);
  }
  const pearlPos = join(inspectDir, "pearl-pos.jpg");
  const pearlLive = join(inspectDir, "pearl-shopee-cdn.jpg");
  if (existsSync(pearlPos) && existsSync(pearlLive)) {
    const sameDrink = fingerprintDistance(
      await imageFingerprint(readFileSync(pearlPos)),
      await imageFingerprint(readFileSync(pearlLive)),
    );
    const cross = fingerprintDistance(await imageFingerprint(pos), await imageFingerprint(readFileSync(pearlPos)));
    assert.ok(sameDrink <= MAX_AHASH_DISTANCE, `pearl POS vs Shopee d=${sameDrink}`);
    assert.ok(cross > MAX_AHASH_DISTANCE, `cocoa vs pearl d=${cross}`);
  }
}

console.log("ok: channel-photo-verify");
