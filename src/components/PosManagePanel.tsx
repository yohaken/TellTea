"use client";

import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";
import { NposOpsLogPanel } from "@/components/NposOpsLogPanel";
import { NposCaptureTimelinePanel } from "@/components/NposCaptureTimelinePanel";
import { PosBusinessSettingsView } from "@/components/PosBusinessSettingsView";

/**
 * หมวดจัดการ Pos — ตั้งค่าร้าน + เครื่องออนไลน์ + ตรวจเครื่อง + ไทม์ไลน์
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        ตั้งค่าร้าน (หัวบิล · PromptPay · เรียงเมนู) อยู่ที่นี่แล้ว — เว็บ POS เคาน์เตอร์เลิกใช้
        <br />
        รายงานจากแอป nPos-telltea · เครื่องออนไลน์ · ไทม์ไลน์ ops / แคป
      </p>
      <section className="pos-manage-settings" aria-label="ตั้งค่าร้าน POS">
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
          ตั้งค่าร้าน (ซิงก์ไป nPos)
        </h2>
        <PosBusinessSettingsView embedded />
      </section>
      <NposDevicesPanel onError={onError} />
      <NposCaptureTimelinePanel onError={onError} />
      <NposOpsLogPanel onError={onError} />
      <NposDiagnosePanel onError={onError} />
    </div>
  );
}
