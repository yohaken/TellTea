"use client";

import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";

/**
 * หมวดจัดการ Pos — N1 ตรวจเครื่อง + N2 รายการเครื่องออนไลน์
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        รายงานจากแอป nPos-telltea — เทสทีละเฟสก่อนย้ายขายหน้าร้านเต็มรูปแบบ
      </p>
      <NposDevicesPanel onError={onError} />
      <NposDiagnosePanel onError={onError} />
    </div>
  );
}
