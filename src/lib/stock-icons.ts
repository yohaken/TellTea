import type { LucideIcon } from "lucide-react";
import {
  Coffee,
  CupSoda,
  Cylinder,
  Disc3,
  GlassWater,
  IceCreamCone,
  Milk,
  Package,
  ShoppingBag,
} from "lucide-react";

/**
 * ชุดไอคอนวัตถุดิบ
 * - IC / ผง = ห่อถุง (ShoppingBag)
 * - ถุงเบเกอรี่ / ถุงเย็น = ถุงหูหิ้ว (ShoppingBag)
 * - ฝาซีล = แพคกลม / แท่งกลม (Disc3)
 * - หลอด = ทรงกระบอกกลม (Cylinder)
 * - โคน = ไอศกรีมโคน (IceCreamCone)
 */
export const STOCK_ICON_OPTIONS = [
  { id: "cup", label: "แก้ว", Icon: CupSoda },
  { id: "straw", label: "หลอด", Icon: Cylinder },
  { id: "lid", label: "ฝาม้วน", Icon: Disc3 },
  { id: "bag", label: "ถุง", Icon: ShoppingBag },
  { id: "bakery", label: "ถุงเบเกอรี่", Icon: ShoppingBag },
  { id: "cold", label: "ถุงเย็น", Icon: ShoppingBag },
  { id: "powder", label: "ห่อถุง", Icon: ShoppingBag },
  { id: "ice", label: "โคน", Icon: IceCreamCone },
  { id: "milk", label: "นม", Icon: Milk },
  { id: "soda", label: "โซดา", Icon: GlassWater },
  { id: "coffee", label: "กาแฟ", Icon: Coffee },
] as const;

export type StockIconId = (typeof STOCK_ICON_OPTIONS)[number]["id"];

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  STOCK_ICON_OPTIONS.map((o) => [o.id, o.Icon]),
);

export function isStockIconId(value: string | undefined | null): value is StockIconId {
  return !!value && value in ICON_MAP;
}

export function stockIconComponent(iconId: string | undefined | null): LucideIcon {
  if (iconId && ICON_MAP[iconId]) return ICON_MAP[iconId]!;
  return Package;
}

/** เดาไอคอนจากชื่อ (ตอนสร้าง / แสดงรายการ) */
export function guessStockIconId(name: string): StockIconId {
  const n = name.trim().toLowerCase();
  // IC = ห่อถุงผง — ต้องก่อนนม / โคน
  if (/\bic\.?/.test(n) || n.startsWith("ic") || /ผงห่อ|ผง /.test(n)) return "powder";
  if (/หลอด|straw/.test(n)) return "straw";
  if (/ฝา|ซีล|lid|ม้วน/.test(n)) return "lid";
  if (/แก้ว|cup/.test(n)) return "cup";
  if (/ถุง.*เย็น|เก็บความเย็น|cooler/.test(n)) return "cold";
  if (/เบเกอ|ถุงกระดาษ|bakery/.test(n)) return "bakery";
  if (/ถุง|bag/.test(n)) return "bag";
  if (/โคน|cone/.test(n)) return "ice";
  if (/นม|milk/.test(n)) return "milk";
  if (/โซดา|soda/.test(n)) return "soda";
  if (/กาแฟ|coffee|โกปี้/.test(n)) return "coffee";
  return "bag";
}
