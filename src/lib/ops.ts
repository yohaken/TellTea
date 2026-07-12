/**
 * รายจ่าย & งานรายวัน — schema และค่าคงที่
 * พนักงาน: บันทึกรายจ่ายวันนี้ + ส่งงาน (เฟสถัดไป)
 * เจ้าของ: ดูทั้งหมด · มอบหมายงาน · ตรวจหลักฐาน
 */

export type OpsUserRole = "admin" | "employee";

export type OpsTaskStatus = "pending" | "completed";

export type OpsExpense = {
  id: string;
  /** staff id หรือ employee id */
  userId: string;
  userName: string;
  date: number;
  amount: number;
  category: string;
  receiptImg?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type OpsTask = {
  id: string;
  userId: string;
  userName: string;
  date: number;
  title: string;
  status: OpsTaskStatus;
  proofImg?: string;
  assignedBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

/** Quick select รายจ่าย — ลดการพิมพ์บนมือถือ */
export const OPS_EXPENSE_QUICK_CATEGORIES = [
  "น้ำแข็ง",
  "แม็คโคร",
  "ตลาด",
  "ขนส่ง",
  "อุปกรณ์",
  "อื่นๆ",
] as const;

export type OpsExpenseQuickCategory = (typeof OPS_EXPENSE_QUICK_CATEGORIES)[number];
