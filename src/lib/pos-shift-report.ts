import type { PosLocalReceipt, PosLocalReceiptLine } from "./pos-local-receipts";
import { summarizeLocalReceipts } from "./pos-local-receipts";
import { receiptDiscountBaht } from "./pos-receipt-view";
import type { PosShopSettings } from "./pos-settings";
import type { MenuCategory, MenuItem } from "./types";

export type ShiftReportKind = "snapshot" | "close";

export type ShiftReportSummary = {
  count: number;
  total: number;
  cashCount: number;
  cashTotal: number;
  promptpayCount: number;
  promptpayTotal: number;
  pendingCount: number;
  voidedCount: number;
};

export type ShiftReportCategoryRow = {
  name: string;
  qty: number;
  amount: number;
};

export type ShiftReportItemRow = {
  name: string;
  qty: number;
  amount: number;
};

export type ShiftReportBillLine = {
  name: string;
  qty: number;
  amount: number;
  optionText?: string;
};

export type ShiftReportBillRow = {
  billNo: string;
  createdAt: number;
  paymentMethod: "cash" | "promptpay";
  total: number;
  discountBaht: number;
  voided: boolean;
  pending: boolean;
  lines: ShiftReportBillLine[];
};

/** สรุปรายละเอียดสำหรับใบพิมพ์ปิดกะ / snapshot — แยกหมวด + รายบิล */
export type ShiftReportDetail = {
  itemQty: number;
  grossSales: number;
  discountTotal: number;
  discountCount: number;
  netSales: number;
  customerCount: number;
  avgPerBill: number;
  byCategory: ShiftReportCategoryRow[];
  byItem: ShiftReportItemRow[];
  bills: ShiftReportBillRow[];
  voidedBills: ShiftReportBillRow[];
  voidedTotal: number;
  dineInCount: number;
  dineInTotal: number;
};

export type ShiftReportPayload = {
  kind: ShiftReportKind;
  shopName: string;
  shopNameTh?: string;
  shopAddress?: string;
  shopPhone?: string;
  deviceCode: string;
  sessionId: string;
  openedAt: number;
  closedAt?: number | null;
  printedAt: number;
  staffName?: string;
  summary: ShiftReportSummary;
  detail?: ShiftReportDetail;
  /** Blind-close / session float — filled when known (native sync or local session). */
  openingCash?: number;
  closingCashCounted?: number;
  expectedCash?: number;
  cashDifference?: number;
  leaveFloat?: number;
  discrepancyLabel?: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineAmount(line: PosLocalReceiptLine) {
  return round2(line.qty * line.unitPrice);
}

function optionText(line: PosLocalReceiptLine): string | undefined {
  if (!line.options?.length) return undefined;
  const parts = line.options
    .map((g) => {
      const choices = (g.choiceNames || []).filter(Boolean).join(", ");
      return choices ? `${g.groupName}: ${choices}` : g.groupName;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function buildMenuIndexes(
  items: MenuItem[] | undefined,
  categories: MenuCategory[] | undefined,
) {
  const catById = new Map<string, string>();
  for (const c of categories || []) catById.set(c.id, c.name);
  const itemById = new Map<string, MenuItem>();
  const itemByName = new Map<string, MenuItem>();
  for (const it of items || []) {
    itemById.set(it.id, it);
    if (it.name) itemByName.set(it.name.trim(), it);
  }
  return { catById, itemById, itemByName };
}

function resolveCategoryName(
  line: PosLocalReceiptLine,
  indexes: ReturnType<typeof buildMenuIndexes>,
): string {
  if (line.categoryName?.trim()) return line.categoryName.trim();
  if (line.menuItemId) {
    const item = indexes.itemById.get(line.menuItemId);
    if (item) {
      const cat = indexes.catById.get(item.categoryId);
      if (cat) return cat;
    }
  }
  const byName = indexes.itemByName.get(line.name.trim());
  if (byName) {
    const cat = indexes.catById.get(byName.categoryId);
    if (cat) return cat;
  }
  return "อื่นๆ";
}

function toBillRow(r: PosLocalReceipt): ShiftReportBillRow {
  const lines = (r.lines || []).map((line) => ({
    name: line.name,
    qty: line.qty,
    amount: lineAmount(line),
    optionText: optionText(line),
  }));
  return {
    billNo: r.billNo,
    createdAt: r.createdAt,
    paymentMethod: r.paymentMethod,
    total: round2(r.total),
    discountBaht: receiptDiscountBaht(r),
    voided: r.voided === true,
    pending: r.pending === true,
    lines,
  };
}

/** รวมยอดจากบิลในเครื่อง — หมวด / รายการ / รายบิล */
export function buildShiftReportDetail(
  receipts: PosLocalReceipt[],
  menu?: { items?: MenuItem[]; categories?: MenuCategory[] },
): ShiftReportDetail {
  const indexes = buildMenuIndexes(menu?.items, menu?.categories);
  const active = receipts.filter((r) => !r.voided);
  const voided = receipts.filter((r) => r.voided);

  const catMap = new Map<string, ShiftReportCategoryRow>();
  const itemMap = new Map<string, ShiftReportItemRow>();
  let itemQty = 0;
  let grossFromLines = 0;
  let billsWithLines = 0;

  for (const r of active) {
    const lines = r.lines || [];
    if (lines.length) {
      billsWithLines += 1;
      for (const line of lines) {
        const amount = lineAmount(line);
        const qty = line.qty;
        itemQty += qty;
        grossFromLines = round2(grossFromLines + amount);

        const catName = resolveCategoryName(line, indexes);
        const cat = catMap.get(catName) || { name: catName, qty: 0, amount: 0 };
        cat.qty += qty;
        cat.amount = round2(cat.amount + amount);
        catMap.set(catName, cat);

        const itemKey = line.name.trim() || "รายการ";
        const item = itemMap.get(itemKey) || { name: itemKey, qty: 0, amount: 0 };
        item.qty += qty;
        item.amount = round2(item.amount + amount);
        itemMap.set(itemKey, item);
      }
    }
  }

  const discountTotal = round2(active.reduce((s, r) => s + receiptDiscountBaht(r), 0));
  const discountCount = active.filter((r) => receiptDiscountBaht(r) > 0).length;
  const netSales = round2(active.reduce((s, r) => s + r.total, 0));

  // บิลเก่าไม่มี lines — ใช้ยอดสุทธิเป็น gross สำหรับส่วนที่ขาด
  const missingGross = active
    .filter((r) => !(r.lines && r.lines.length))
    .reduce((s, r) => s + r.total + receiptDiscountBaht(r), 0);
  const grossSales =
    billsWithLines === active.length
      ? grossFromLines
      : round2(grossFromLines + missingGross);

  if (missingGross > 0 && active.some((r) => !(r.lines && r.lines.length))) {
    const orphanQty = active.filter((r) => !(r.lines && r.lines.length)).length;
    const cat = catMap.get("อื่นๆ") || { name: "อื่นๆ", qty: 0, amount: 0 };
    cat.qty += orphanQty;
    cat.amount = round2(cat.amount + missingGross);
    catMap.set("อื่นๆ", cat);
  }

  const byCategory = [...catMap.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "th"));
  const byItem = [...itemMap.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "th"));

  const customerCount = active.length;
  const avgPerBill = customerCount > 0 ? round2(netSales / customerCount) : 0;

  const voidedBills = voided.map(toBillRow);
  const voidedTotal = round2(voided.reduce((s, r) => s + r.total, 0));

  return {
    itemQty: itemQty || customerCount,
    grossSales,
    discountTotal,
    discountCount,
    netSales,
    customerCount,
    avgPerBill,
    byCategory,
    byItem,
    bills: active.map(toBillRow),
    voidedBills,
    voidedTotal,
    dineInCount: customerCount,
    dineInTotal: netSales,
  };
}

export function buildShiftReportPayload(input: {
  kind: ShiftReportKind;
  shop: PosShopSettings;
  deviceCode: string;
  sessionId: string;
  openedAt: number;
  closedAt?: number | null;
  summary: ShiftReportSummary;
  receipts?: PosLocalReceipt[];
  menu?: { items?: MenuItem[]; categories?: MenuCategory[] };
  openingCash?: number;
  closingCashCounted?: number;
  expectedCash?: number;
  cashDifference?: number;
  leaveFloat?: number;
  discrepancyLabel?: string;
}): ShiftReportPayload {
  const detail =
    input.receipts && input.receipts.length > 0
      ? buildShiftReportDetail(input.receipts, input.menu)
      : undefined;

  // ถ้าส่ง receipts มา — ใช้ summarize จาก receipts เป็นหลักเมื่อ summary ว่าง/ไม่ครบ
  const summary =
    input.receipts && input.receipts.length > 0
      ? summarizeLocalReceipts(input.receipts)
      : input.summary;

  return {
    kind: input.kind,
    shopName: input.shop.shopName,
    shopNameTh: input.shop.shopNameTh,
    shopAddress: input.shop.shopAddress,
    shopPhone: input.shop.shopPhone,
    deviceCode: input.deviceCode,
    sessionId: input.sessionId,
    openedAt: input.openedAt,
    closedAt: input.closedAt ?? null,
    printedAt: Date.now(),
    staffName: input.shop.receiptStaffName,
    summary,
    detail,
    openingCash: input.openingCash,
    closingCashCounted: input.closingCashCounted,
    expectedCash: input.expectedCash,
    cashDifference: input.cashDifference,
    leaveFloat: input.leaveFloat,
    discrepancyLabel: input.discrepancyLabel,
  };
}
