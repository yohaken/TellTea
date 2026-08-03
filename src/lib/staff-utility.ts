/**
 * ไอคอนยูทิลิตี้พนักงาน (ซ้ายกลางจอ) — ช่องรวมของเล็กๆ
 * ตอนนี้: ข้อเสนอ · ลิงก์กระดานโนต (/tasks/)
 */

export const STAFF_UTILITY_SLOTS = ["suggestions", "tasks"] as const;
export type StaffUtilitySlot = (typeof STAFF_UTILITY_SLOTS)[number];

export type StaffUtilitySlotMeta = {
  key: StaffUtilitySlot;
  label: string;
  /** true = ยังลิงก์ไปหน้าเดิม / UI เบา — ยังไม่ย้ายฟีเจอร์เต็ม */
  scaffold: boolean;
  href?: string;
};

export const STAFF_UTILITY_CATALOG: Record<StaffUtilitySlot, StaffUtilitySlotMeta> = {
  suggestions: {
    key: "suggestions",
    label: "ข้อเสนอ",
    scaffold: false,
  },
  tasks: {
    key: "tasks",
    label: "โนต",
    scaffold: false,
    href: "/tasks/",
  },
};

/** นับสำหรับกระพริบไอคอน — ข้อเสนอที่รอเจ้าของดู (ยกเลิกนับงาน checklist) */
export function staffUtilityAttentionCount(opts: {
  pendingTaskCount?: number;
  pendingSuggestionCount: number;
}): number {
  return Math.max(0, Math.floor(opts.pendingSuggestionCount || 0));
}
