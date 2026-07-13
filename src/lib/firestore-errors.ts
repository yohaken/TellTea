export type FirestoreErrorHint = "staff" | "pos";

/** แปลงข้อความ Firebase เป็นภาษาไทยที่เข้าใจง่าย */
export function mapFirestoreError(
  error: unknown,
  context?: string,
  hint: FirestoreErrorHint = "staff",
): string {
  const code = (error as { code?: string })?.code || "";
  const message = (error as Error)?.message || "";
  if (code === "permission-denied" || /insufficient permissions/i.test(message)) {
    if (hint === "pos") {
      return context
        ? `${context} — สิทธิ์ไม่พอ ลองรีเฟรชหน้า POS หรือรอระบบอัปเดต 1–2 นาที`
        : "สิทธิ์ไม่พอ — ลองรีเฟรชหน้า POS";
    }
    return context
      ? `${context} — สิทธิ์ไม่พอ (ลองออกจากระบบแล้วเข้าใหม่ หรือให้เจ้าของเปิดสิทธิ์จัดการพนักงาน)`
      : "สิทธิ์ไม่พอ — ลองออกจากระบบแล้วเข้าใหม่";
  }
  if (code === "unavailable" || /network/i.test(message)) {
    return context ? `${context} — เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง` : "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง";
  }
  return message || context || "เกิดข้อผิดพลาด";
}
