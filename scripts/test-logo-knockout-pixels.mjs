/**
 * Pixel-level proof: baked #fff/#ccc checkerboard clears; navy Tell Tea ink stays.
 * Mirrors knockOutLogoLightBackground without DOM canvas.
 */
import assert from "node:assert/strict";

function isLogoKnockoutRgb(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  const chroma = max - min;
  if (avg >= 205 && chroma <= 60) return true;
  if (avg >= 155 && avg <= 245 && chroma <= 22) return true;
  return false;
}

function knockOut(data, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  let cleared = 0;
  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i]) return;
    const o = i * 4;
    if (data[o + 3] < 12) {
      seen[i] = 1;
      return;
    }
    if (!isLogoKnockoutRgb(data[o], data[o + 1], data[o + 2])) return;
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
    data[o + 3] = 0;
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
  return cleared;
}

function setPx(data, w, x, y, r, g, b, a = 255) {
  const o = (y * w + x) * 4;
  data[o] = r;
  data[o + 1] = g;
  data[o + 2] = b;
  data[o + 3] = a;
}

function getA(data, w, x, y) {
  return data[(y * w + x) * 4 + 3];
}

const W = 64;
const H = 64;
const data = new Uint8ClampedArray(W * H * 4);

// Photoshop-like transparency grid baked as pixels
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const tile = (((x / 8) | 0) + ((y / 8) | 0)) % 2 === 0;
    if (tile) setPx(data, W, x, y, 255, 255, 255);
    else setPx(data, W, x, y, 204, 204, 204); // #ccc
  }
}

// Navy mark in the middle (Tell Tea-like)
for (let y = 20; y < 44; y++) {
  for (let x = 20; x < 44; x++) {
    setPx(data, W, x, y, 20, 40, 90);
  }
}

const cleared = knockOut(data, W, H);
assert.ok(cleared > 2000, `expected large clear, got ${cleared}`);

// Corners of grid must be transparent
assert.equal(getA(data, W, 0, 0), 0);
assert.equal(getA(data, W, 63, 0), 0);
assert.equal(getA(data, W, 0, 63), 0);
assert.equal(getA(data, W, 8, 8), 0); // grey tile
assert.equal(getA(data, W, 12, 4), 0); // white tile

// Navy block stays opaque
assert.equal(getA(data, W, 32, 32), 255);
assert.equal(data[(32 * W + 32) * 4], 20);
assert.equal(data[(32 * W + 32) * 4 + 2], 90);

// Edge of navy still ink
assert.equal(getA(data, W, 20, 20), 255);

console.log("OK test-logo-knockout-pixels", { cleared });
