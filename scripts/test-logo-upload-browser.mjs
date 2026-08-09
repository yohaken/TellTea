/**
 * Real Chromium test: bake checkerboard PNG → decode → knock out → encode.
 * Proves the mobile upload image pipeline clears fake transparency grids.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function findChrome() {
  try {
    const pw = await import("playwright");
    return { type: "playwright", chromium: pw.chromium };
  } catch {
    /* use playwright-core + channel */
  }
  return { type: "core", chromium };
}

const { chromium: cr } = await findChrome();

const browser = await cr.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
}).catch(async (err) => {
  // Fallback: bundled chromium if available via full playwright
  try {
    const pw = await import("playwright");
    return pw.chromium.launch({ headless: true, args: ["--no-sandbox"] });
  } catch {
    throw err;
  }
});

const page = await browser.newPage();
const result = await page.evaluate(async () => {
  function isLogoKnockoutRgb(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    const chroma = max - min;
    if (avg >= 205 && chroma <= 60) return true;
    if (avg >= 155 && avg <= 245 && chroma <= 22) return true;
    return false;
  }

  function knockOut(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const seen = new Uint8Array(w * h);
    const stack = [];
    let cleared = 0;
    const tryPush = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (seen[i]) return;
      const o = i * 4;
      if (d[o + 3] < 12) {
        seen[i] = 1;
        return;
      }
      if (!isLogoKnockoutRgb(d[o], d[o + 1], d[o + 2])) return;
      seen[i] = 1;
      stack.push(i);
    };
    for (let x = 0; x < w; x++) {
      tryPush(x, 0);
      tryPush(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      tryPush(0, y);
      tryPush(w - 1, y);
    }
    while (stack.length) {
      const i = stack.pop();
      const o = i * 4;
      d[o + 3] = 0;
      cleared += 1;
      const x = i % w;
      const y = (i / w) | 0;
      tryPush(x + 1, y);
      tryPush(x - 1, y);
      tryPush(x, y + 1);
      tryPush(x, y - 1);
      tryPush(x + 1, y + 1);
      tryPush(x - 1, y - 1);
      tryPush(x + 1, y - 1);
      tryPush(x - 1, y + 1);
    }
    ctx.putImageData(img, 0, 0);
    return cleared;
  }

  // 1) Bake a fake-transparent checkerboard PNG (like the user's file)
  const src = document.createElement("canvas");
  src.width = 160;
  src.height = 160;
  const sctx = src.getContext("2d");
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 160; x++) {
      const tile = (((x / 10) | 0) + ((y / 10) | 0)) % 2 === 0;
      sctx.fillStyle = tile ? "#ffffff" : "#cccccc";
      sctx.fillRect(x, y, 1, 1);
    }
  }
  sctx.fillStyle = "#14285a";
  sctx.beginPath();
  sctx.arc(80, 70, 28, 0, Math.PI * 2);
  sctx.fill();
  sctx.font = "bold 22px sans-serif";
  sctx.textAlign = "center";
  sctx.fillText("Tell Tea", 80, 130);
  const bakedPng = src.toDataURL("image/png");

  // 2) Decode as upload would (Image → canvas resize → knock out)
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = bakedPng;
  });
  const out = document.createElement("canvas");
  out.width = 120;
  out.height = 120;
  const octx = out.getContext("2d", { willReadFrequently: true });
  octx.clearRect(0, 0, 120, 120);
  octx.drawImage(img, 0, 0, 120, 120);
  const cleared = knockOut(octx, 120, 120);
  const finalPng = out.toDataURL("image/png");
  const sample = octx.getImageData(0, 0, 120, 120).data;
  const cornerA = sample[3];
  const mid = (60 * 120 + 60) * 4;
  const midA = sample[mid + 3];
  const midR = sample[mid];
  const midB = sample[mid + 2];
  // grey tile interior near edge
  const greyA = sample[(5 * 120 + 15) * 4 + 3];

  return {
    cleared,
    cornerA,
    greyA,
    midA,
    midR,
    midB,
    bakedLen: bakedPng.length,
    finalLen: finalPng.length,
    isPng: finalPng.startsWith("data:image/png"),
  };
});

await browser.close();

assert.equal(result.isPng, true);
assert.ok(result.cleared > 5000, `cleared=${result.cleared}`);
assert.equal(result.cornerA, 0, "corner must be transparent");
assert.equal(result.greyA, 0, "checker grey must be transparent");
assert.equal(result.midA, 255, "navy mark must stay");
assert.ok(result.midR < 80 && result.midB > 40, "navy color retained");

console.log("OK test-logo-upload-browser", result);
