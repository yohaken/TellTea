"use client";

import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";
import { NposOpsLogPanel } from "@/components/NposOpsLogPanel";

/**
 * หมวดจัดการ Pos — เครื่องออนไลน์ + ตรวจเครื่อง + ไทม์ไลน์ ops
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        รายงานจากแอป nPos-telltea — เทสทีละเฟสก่อนย้ายขายหน้าร้านเต็มรูปแบบ · error/ฮาร์ดแวร์เข้าไทม์ไลน์อัตโนมัติ
      </p>
      <NposDevicesPanel onError={onError} />
      <NposOpsLogPanel onError={onError} />
      <NposDiagnosePanel onError={onError} />
    </div>
  );
}
