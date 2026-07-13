import type { StaffPermissions } from "./permissions";

export type StaffRole = "owner" | "staff";

export type StaffMember = {
  /** Firestore doc id — email หรือ p_66812345678 */
  id: string;
  email?: string;
  /** E.164 เช่น +66812345678 */
  phone?: string;
  role: StaffRole;
  displayName?: string;
  /** อ้างอิง employees/{id} — ชื่อในรoster ร้าน */
  employeeId?: string;
  /** true เมื่อพนักงานเชื่อมชื่อกับรายชื่อร้านแล้ว */
  profileComplete?: boolean;
  /** กด "ภายหลัง" บนแบนเนอร์ชื่อร้าน — ซ่อนจนกว่าจะถึงเวลานี้ (ms) */
  profileSnoozeUntil?: number;
  /** true เมื่อกรอกข้อมูลส่วนตัวครบแล้ว */
  personalProfileComplete?: boolean;
  /** โหลดเฉพาะ session ตัวเอง — ไม่มีใน listStaff */
  personal?: StaffPersonalData;
  createdAt: number;
  /** Fine-grained page/feature access — owners always get full set in resolvePermissions */
  permissions?: Partial<StaffPermissions>;
};

/** ข้อมูลส่วนตัวละเอียดอ่อน — คอลเลกชัน staffPersonal (เจ้าของอ่านได้) */
export type StaffPersonalData = {
  legalFirstName?: string;
  legalLastName?: string;
  idCardPhotoUrl?: string;
  personalDataConsentAt?: number;
  updatedAt?: number;
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

/** รอบนับสต๊อก — วันที่ 1, 10, 20 ของเดือน */
export type StockCountRound = 1 | 10 | 20;

export type StockCountLine = {
  itemId: string;
  itemName: string;
  qty: number;
};

export type StockCountSession = {
  id: string;
  /** local midnight ms */
  date: number;
  dayOfMonth: StockCountRound;
  year: number;
  /** 0-indexed */
  month: number;
  inspector: string;
  inspectorId?: string;
  submittedAt: number;
  createdBy: string;
  lines: StockCountLine[];
};

export type StockCountSessionInput = {
  date: number;
  dayOfMonth: StockCountRound;
  year: number;
  month: number;
  inspector: string;
  inspectorId?: string;
  submittedAt: number;
  createdBy: string;
  lines: StockCountLine[];
};

/** POS — หมวดเมนูหน้าร้าน */
export type MenuCategory = {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

/** POS — รายการเมนู */
export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  sortOrder: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type PosSaleLine = {
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
};

/** POS — รอบขาย (เปิดกะขายบนเครื่อง) */
export type PosSession = {
  id: string;
  deviceId: string;
  date: number;
  shift: string;
  openedAt: number;
  status: "open" | "closed";
  saleCount: number;
  totalSales: number;
};

export type PosSale = {
  id: string;
  deviceId: string;
  sessionId: string;
  date: number;
  shift: string;
  lines: PosSaleLine[];
  subtotal: number;
  total: number;
  paymentMethod: "cash";
  cashReceived: number;
  change: number;
  ledgerEntryId: string;
  createdAt: number;
  createdBy: string;
  status: "completed";
};
