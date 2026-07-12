import type { StaffPermissions } from "./permissions";

export type StaffRole = "owner" | "staff";

export type StaffMember = {
  email: string;
  role: StaffRole;
  displayName?: string;
  createdAt: number;
  /** Fine-grained page/feature access — owners always get full set in resolvePermissions */
  permissions?: Partial<StaffPermissions>;
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
  /** เวลาแก้ไขล่าสุด (ms) — แถวเก่าอาจไม่มี ใช้ createdAt แทนตอนแสดง */
  updatedAt?: number;
  /** URL สลิป/รูปใบเสร็จ (ถ้ามี) */
  receiptUrl?: string;
};

export type LedgerEntryInput = {
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  type: string;
  createdBy: string;
  receiptUrl?: string;
};

/** Perpetual inventory — วัตถุดิบร้าน (Products) */
export type StockItem = {
  id: string;
  /** item_name */
  name: string;
  unit: string;
  /** current_stock */
  qty: number;
  /** reorder_point — เตือนเมื่อ qty ≤ ค่านี้ */
  minQty: number;
  /** safety_stock — สต๊อกสำรอง */
  safetyStock: number;
  /** ราคาต่อหน่วย (บาท) — ใช้คำนวณมูลค่าคงคลัง */
  unitCost: number;
  /** บาร์โค้ดสำหรับสแกนค้นหา */
  barcode?: string;
  note?: string;
  updatedAt: number;
  updatedBy: string;
};

export type StockItemInput = {
  name: string;
  unit: string;
  qty: number;
  minQty: number;
  safetyStock?: number;
  unitCost?: number;
  barcode?: string;
  note?: string;
  updatedBy: string;
};

export type StockMovementType = "IN" | "OUT" | "ADJUST";

/** ประวัติการขยับสต๊อก (Stock Movements) */
export type StockMovement = {
  id: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
  /** จำนวนที่ขยับ (เป็นบวกเสมอ) */
  quantity: number;
  /** ยอดก่อน / หลัง (ADJUST) */
  qtyBefore?: number;
  qtyAfter?: number;
  date: number;
  inspector: string;
  remark: string;
  createdAt: number;
  createdBy: string;
};

export type StockMovementInput = {
  itemId: string;
  itemName: string;
  type: StockMovementType;
  quantity: number;
  qtyBefore?: number;
  qtyAfter?: number;
  date: number;
  inspector: string;
  remark?: string;
  createdBy: string;
};
