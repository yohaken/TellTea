export type StaffRole = "owner" | "staff";

export type StaffMember = {
  email: string;
  role: StaffRole;
  displayName?: string;
  createdAt: number;
};

/** สมุดบัญชีเข้า–ออก ตามชีทร้าน */
export type LedgerEntry = {
  id: string;
  /** วันของรายการ (local midnight ms) */
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  type: string;
  createdBy: string;
  createdAt: number;
};

export type LedgerEntryInput = {
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  type: string;
  createdBy: string;
};

/** สต็อกเบาๆ — ของใช้ประจำร้าน ไม่ใช่คลังสินค้าเต็มระบบ */
export type StockItem = {
  id: string;
  name: string;
  unit: string;
  qty: number;
  /** เตือนเมื่อเหลือไม่เกินจำนวนนี้ (0 = ไม่เตือน) */
  minQty: number;
  note?: string;
  updatedAt: number;
  updatedBy: string;
};

export type StockItemInput = {
  name: string;
  unit: string;
  qty: number;
  minQty: number;
  note?: string;
  updatedBy: string;
};
