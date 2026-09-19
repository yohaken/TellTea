/**
 * แจ้งเตือนคลังต่ำ — ต่อรายการต้องติ๊กเปิด + มีเกณฑ์ minQty
 * ระบบ LINE ใช้ร่วมกับ owner notify (เหมือนยอดเงินพนักงานต่ำ)
 */
import type { StockItem } from "./types";

export type StockAlertFields = Pick<StockItem, "alertEnabled" | "minQty" | "qty" | "name" | "unit">;

/** รายการนี้ติดเงื่อนไขแจ้งเตือน (ติ๊กเปิด + คงเหลือ ≤ เกณฑ์) */
export function stockItemAlertArmed(item: StockAlertFields): boolean {
  return Boolean(item.alertEnabled) && item.minQty > 0 && item.qty <= item.minQty;
}

/** แสดงแบดจ์ต่ำใน UI (มีเกณฑ์) — ไม่ต้องติ๊กเปิด */
export function stockItemBelowMin(item: Pick<StockItem, "minQty" | "qty">): boolean {
  return item.minQty > 0 && item.qty <= item.minQty;
}

export function listArmedStockAlerts(items: StockAlertFields[]): StockAlertFields[] {
  return items.filter(stockItemAlertArmed);
}

export function formatStockLowLineBody(
  items: StockAlertFields[],
  opts?: { force?: boolean },
): string {
  const rows = listArmedStockAlerts(items);
  const lines = [
    "TellTea — คลังต่ำกว่าเกณฑ์",
    rows.length ? `${rows.length} รายการ` : "ไม่มีรายการติดเงื่อนไข",
  ];
  for (const row of rows.slice(0, 12)) {
    lines.push(
      `· ${row.name}: ${row.qty} ${row.unit || ""} (≤ ${row.minQty})`.replace(
        /\s+/g,
        " ",
      ).trim(),
    );
  }
  if (rows.length > 12) {
    lines.push(`· …อีก ${rows.length - 12} รายการ`);
  }
  if (opts?.force) lines.push("(ตรวจด้วยมือจากหน้าตั้งค่า)");
  lines.push("เปิดคลัง: https://telltea-bo.web.app/stock/");
  return lines.filter(Boolean).join("\n");
}
