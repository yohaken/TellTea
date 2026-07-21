"use client";

import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";

/**
 * หมวดจัดการ Pos — เริ่มด้วยผลตรวจเครื่องจาก nPos (เฟส N1)
 * เว็บ POS admin เดิมยังไม่ลบจนกว่า native ครบเฟส
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        รายงานจากแอป nPos-telltea — ใช้เทสฟังก์ชันทีละเฟสก่อนย้ายขายหน้าร้านเต็มรูปแบบ
      </p>
      <NposDiagnosePanel onError={onError} />
    </div>
  );
}
