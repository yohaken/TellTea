import type { LucideIcon } from "lucide-react";
import {
  FileText,
  LayoutGrid,
  LogOut,
  Receipt,
  Settings2,
  ShoppingBag,
  Timer,
} from "lucide-react";

export type PosNavId =
  | "sell"
  | "members"
  | "open-bills"
  | "receipts"
  | "inventory"
  | "shift"
  | "menu"
  | "ops"
  | "settings";

export type PosNavItem = {
  id: PosNavId;
  href: string;
  label: string;
  icon: LucideIcon;
  /** แสดงเฉพาะเมื่อเปิดขายแล้ว */
  requiresSelling?: boolean;
};

/**
 * POS counter nav — cut from shop BO and from menu/ops/inventory admin.
 * Device settings stay on telltea-pos host only (printer / identity).
 * Routes for inventory/ops/menu may still exist as stubs or owner URLs.
 */
export const POS_NAV_ITEMS: PosNavItem[] = [
  { id: "sell", href: "/pos/sell/", label: "สั่งและชำระเงิน", icon: ShoppingBag },
  // members / coupon — hidden until real CRM (F3)
  { id: "open-bills", href: "/pos/open-bills/", label: "บิลที่เปิดอยู่", icon: FileText, requiresSelling: true },
  { id: "receipts", href: "/pos/receipts/", label: "ประวัติใบเสร็จ", icon: Receipt },
  // inventory · ops · menu — cut (BO / admin). No counter entry.
  { id: "shift", href: "/pos/shift/", label: "รอบการขาย", icon: Timer },
  { id: "settings", href: "/pos/settings/", label: "ตั้งค่าเครื่อง", icon: Settings2 },
];

export const POS_LOCK_HREF = "/pos/lock/";

export function posNavLockItem(): { href: string; label: string; icon: LucideIcon } {
  return { href: POS_LOCK_HREF, label: "กลับหน้า PIN", icon: LogOut };
}

export function matchPosNav(pathname: string): PosNavId | null {
  const p = pathname.replace(/\/$/, "");
  if (p.endsWith("/pos/sell")) return "sell";
  if (p.endsWith("/pos/members")) return "members";
  if (p.endsWith("/pos/open-bills")) return "open-bills";
  if (p.endsWith("/pos/receipts")) return "receipts";
  if (p.endsWith("/pos/inventory")) return "inventory";
  if (p.endsWith("/pos/shift")) return "shift";
  if (p.endsWith("/pos/menu")) return "menu";
  if (p.endsWith("/pos/ops")) return "ops";
  if (p.endsWith("/pos/settings")) return "settings";
  if (p === "/pos") return "sell";
  return null;
}

/** ไอคอนกริดสำหรับปุ่มเพิ่มเมนู */
export const PosMenuGridIcon = LayoutGrid;
