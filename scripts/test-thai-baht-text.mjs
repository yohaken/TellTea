import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/thai-baht-text.ts"), "utf8");
assert.match(src, /export function thaiBahtText/);

const DIGIT = [
  "ศูนย์",
  "หนึ่ง",
  "สอง",
  "สาม",
  "สี่",
  "ห้า",
  "หก",
  "เจ็ด",
  "แปด",
  "เก้า",
];

function readUnderMillion(n) {
  const units = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
  let s = "";
  const str = String(n);
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const d = Number(str[i]);
    const pos = len - i - 1;
    if (!d) continue;
    if (pos === 1) {
      if (d === 1) s += "สิบ";
      else if (d === 2) s += "ยี่สิบ";
      else s += `${DIGIT[d]}สิบ`;
    } else if (pos === 0) {
      if (d === 1 && len > 1) s += "เอ็ด";
      else s += DIGIT[d];
    } else {
      s += `${DIGIT[d]}${units[pos]}`;
    }
  }
  return s;
}

function readNumber(n) {
  n = Math.floor(Math.abs(n));
  if (!n) return DIGIT[0];
  const parts = [];
  let rest = n;
  let lvl = 0;
  while (rest > 0) {
    const block = rest % 1e6;
    rest = Math.floor(rest / 1e6);
    if (block) {
      parts.unshift(
        `${readUnderMillion(block)}${lvl ? "ล้าน".repeat(lvl) : ""}`,
      );
    }
    lvl += 1;
  }
  return parts.join("");
}

function thaiBahtText(amount) {
  const rounded = Math.round(amount * 100) / 100;
  const abs = Math.abs(rounded);
  const baht = Math.floor(abs + 1e-9);
  const satang = Math.round((abs - baht) * 100);
  let t =
    `${readNumber(baht)}บาท` +
    (satang <= 0 ? "ถ้วน" : `${readNumber(satang)}สตางค์`);
  return rounded < 0 ? `ลบ${t}` : t;
}

assert.equal(thaiBahtText(8200), "แปดพันสองร้อยบาทถ้วน");
assert.equal(thaiBahtText(11200), "หนึ่งหมื่นหนึ่งพันสองร้อยบาทถ้วน");
assert.equal(thaiBahtText(21), "ยี่สิบเอ็ดบาทถ้วน");
assert.equal(thaiBahtText(1.5), "หนึ่งบาทห้าสิบสตางค์");
console.log("test-thai-baht-text: ok");
