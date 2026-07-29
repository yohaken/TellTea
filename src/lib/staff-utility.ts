/**
 * ไอคอนยูทิลิตี้พนักงาน (ซ้ายกลางจอ) — ช่องรวมของเล็กๆ
 * ตอนนี้: ข้อเสนอ · โครง: มอบหมายงาน (กระพริบเมื่อมีค้าง)
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
    label: "งาน",
    scaffold: true,
    href: "/tasks/",
  },
};

/** นับสำหรับกระพริบไอคอน — งานค้าง + ข้อเสนอที่รอเจ้าของดู */
export function staffUtilityAttentionCount(opts: {
  pendingTaskCount: number;
  pendingSuggestionCount: number;
}): number {
  const tasks = Math.max(0, Math.floor(opts.pendingTaskCount || 0));
  const suggestions = Math.max(0, Math.floor(opts.pendingSuggestionCount || 0));
  return tasks + suggestions;
}
