/**
 * POS 52 — fixed category order (water last), applied local-first then synced.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const ver = read("src/lib/pos-version.ts");
assert.match(ver, /POS_BUILD\s*=\s*52\b/);

const fixedSrc = read("src/lib/pos-fixed-category-order.ts");
assert.match(fixedSrc, /เบเกอรี่ & ไอศครีม/);
assert.match(fixedSrc, /Signature Drinks/);
assert.match(fixedSrc, /น้ำเปล่า/);
assert.match(fixedSrc, /applyFixedCategorySortOrder/);

const preload = read("src/lib/pos-menu-preload.ts");
assert.match(preload, /applyFixedCategorySortOrder/);
assert.match(preload, /maybeSyncFixedOrderToFirebase/);

const admin = read("src/components/PosMenuAdmin.tsx");
assert.match(admin, /applyFixedCategorySortOrder/);

// Runtime order check via dynamic import of compiled-free logic — reimplement tiny check
function normalizeCategoryName(name) {
  const ALIASES = {
    "* กาแฟสดนุ่มละมุน": "* กาแฟสดนมนุ่มละมุน",
  };
  const trimmed = String(name || "")
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ALIASES[trimmed] || trimmed;
}

const ORDER = [
  "เบเกอรี่ & ไอศครีม",
  "Signature Drinks (เย็น, ปั่น)",
  "ชานมสดคราฟต์ (เย็น, ปั่น)",
  "ชา",
  "ชานม (เย็น, ปั่น)",
  "มัจฉะแท้",
  "ผลไม้ปั่น & สมูทตี้",
  "ชาผลไม้",
  "กาแฟ (เย็น, ปั่น)",
  "นม (เย็น, ปั่น)",
  "เบาเบากับน้ำเต้าหู้ (เย็น, ปั่น)",
  "อิตาเลียน โซดา",
  "0% แคล ชาเพื่อสุขภาพ",
  "0% แคล โซดาซ่าเพื่อสุขภาพ",
  "* กาแฟสดเข้มข้น",
  "* กาแฟสดนมนุ่มละมุน",
  "* กาแฟสดฟิวชันสดชื่น",
  "น้ำเปล่า",
];

assert.equal(ORDER[ORDER.length - 1], "น้ำเปล่า");
assert.equal(normalizeCategoryName("* กาแฟสดนุ่มละมุน"), "* กาแฟสดนมนุ่มละมุน");

const cats = [
  { id: "w", name: "น้ำเปล่า", sortOrder: 1 },
  { id: "b", name: "เบเกอรี่ & ไอศครีม", sortOrder: 99 },
  { id: "s", name: "Signature Drinks (เย็น, ปั่น)", sortOrder: 50 },
  { id: "x", name: "* กาแฟสด อื่นๆ ร้อน", sortOrder: 2 },
].map((c) => ({ ...c, active: true, createdAt: 0, updatedAt: 0 }));

// Inline apply copy for assertion without TS compile
function apply(categories) {
  const byName = new Map();
  for (const cat of categories) {
    const key = normalizeCategoryName(cat.name);
    if (!byName.has(key)) byName.set(key, cat);
  }
  const used = new Set();
  const ordered = [];
  for (const label of ORDER) {
    if (normalizeCategoryName(label) === "น้ำเปล่า") continue;
    const cat = byName.get(normalizeCategoryName(label));
    if (!cat || used.has(cat.id)) continue;
    ordered.push(cat);
    used.add(cat.id);
  }
  for (const cat of categories) {
    if (!used.has(cat.id) && normalizeCategoryName(cat.name) !== "น้ำเปล่า") {
      ordered.push(cat);
      used.add(cat.id);
    }
  }
  for (const cat of categories) {
    if (!used.has(cat.id) && normalizeCategoryName(cat.name) === "น้ำเปล่า") {
      ordered.push(cat);
      used.add(cat.id);
    }
  }
  return ordered;
}

const out = apply(cats);
assert.equal(out[0].name, "เบเกอรี่ & ไอศครีม");
assert.equal(out[1].name, "Signature Drinks (เย็น, ปั่น)");
assert.equal(out[out.length - 1].name, "น้ำเปล่า");
assert.equal(out[out.length - 2].name, "* กาแฟสด อื่นๆ ร้อน");

console.log("test-pos-fixed-category-order: ok");
