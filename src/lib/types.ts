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
