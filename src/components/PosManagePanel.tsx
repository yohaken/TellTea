"use client";

import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";
import { NposOpsLogPanel } from "@/components/NposOpsLogPanel";
import { NposCaptureTimelinePanel } from "@/components/NposCaptureTimelinePanel";
import { PosBusinessSettingsView } from "@/components/PosBusinessSettingsView";
import { PosStoreClaimPanel } from "@/components/PosStoreClaimPanel";

/**
 * หมวดจัดการ Pos — ตั้งค่าร้าน + รหัสเคลม + เครื่อง + ตรวจเครื่อง + ไทม์ไลน์
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        1) ตั้งชื่อ/ที่อยู่ → กด <strong>บันทึกขึ้น Firebase</strong> · 2) ตั้งรหัสร้าน → เปิดเกต ·
        3) แท็บเล็ตกรอกรหัส · ถ้าติด seat กด <strong>เตะ / เคลียร์ seat</strong>
      </p>
      <section className="pos-manage-settings" aria-label="ตั้งค่าร้าน POS">
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
          ตั้งค่าร้าน (ซิงก์ไป nPos)
        </h2>
        <PosBusinessSettingsView embedded />
      </section>
      <PosStoreClaimPanel onError={onError} />
      <NposDevicesPanel onError={onError} />
      <NposCaptureTimelinePanel onError={onError} />
      <NposOpsLogPanel onError={onError} />
      <NposDiagnosePanel onError={onError} />
    </div>
  );
}
