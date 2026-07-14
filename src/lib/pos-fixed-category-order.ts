import type { MenuCategory } from "./types";

/**
 * ลำดับหมวดเมนูคงที่ชั่วคราว (ช่วงที่ Firebase sortOrder ยังไม่นิ่ง)
 * ตามหน้า เมนูหลังร้าน — น้ำเปล่าอยู่ท้ายสุดเสมอ
 */
export const POS_FIXED_CATEGORY_ORDER: readonly string[] = [
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

/** ชื่อที่อาจต่างจากข้อมูลจริงเล็กน้อย → ชื่อในลำดับคงที่ */
const ALIASES: Record<string, string> = {
  "* กาแฟสดนุ่มละมุน": "* กาแฟสดนมนุ่มละมุน",
  "*กาแฟสดนุ่มละมุน": "* กาแฟสดนมนุ่มละมุน",
  "*กาแฟสดนมนุ่มละมุน": "* กาแฟสดนมนุ่มละมุน",
  "* กาแฟสด นมนุ่มละมุน": "* กาแฟสดนมนุ่มละมุน",
};

export function normalizeCategoryName(name: string): string {
  const trimmed = String(name || "")
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ALIASES[trimmed] || trimmed;
}

function isWaterCategory(name: string): boolean {
  return normalizeCategoryName(name) === "น้ำเปล่า";
}

/**
 * ทับ sortOrder ตามลำดับคงที่
 * - หมวดที่ไม่ได้อยู่ในลิสต์ → ต่อท้ายก่อนน้ำเปล่า
 * - น้ำเปล่า → ท้ายสุดเสมอ
 */
export function applyFixedCategorySortOrder(categories: MenuCategory[]): MenuCategory[] {
  if (!categories.length) return categories;

  const byName = new Map<string, MenuCategory>();
  for (const cat of categories) {
    const key = normalizeCategoryName(cat.name);
    if (!byName.has(key)) byName.set(key, cat);
  }

  const used = new Set<string>();
  const ordered: MenuCategory[] = [];

  for (const label of POS_FIXED_CATEGORY_ORDER) {
    if (isWaterCategory(label)) continue;
    const key = normalizeCategoryName(label);
    const cat = byName.get(key);
    if (!cat || used.has(cat.id)) continue;
    ordered.push(cat);
    used.add(cat.id);
  }

  const extras = categories
    .filter((c) => !used.has(c.id) && !isWaterCategory(c.name))
    .slice()
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"),
    );
  for (const cat of extras) {
    ordered.push(cat);
    used.add(cat.id);
  }

  for (const cat of categories) {
    if (used.has(cat.id)) continue;
    if (isWaterCategory(cat.name)) {
      ordered.push(cat);
      used.add(cat.id);
    }
  }

  return ordered.map((cat, i) => ({
    ...cat,
    sortOrder: (i + 1) * 1000,
  }));
}

export function fixedCategoryOrderKey(categories: MenuCategory[]): string {
  return applyFixedCategorySortOrder(categories)
    .map((c) => c.id)
    .join("|");
}
