"use client";

import { Activity, KeyRound, Store } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";
import { NposOpsLogPanel } from "@/components/NposOpsLogPanel";
import { NposCaptureTimelinePanel } from "@/components/NposCaptureTimelinePanel";
import { PosBusinessSettingsView } from "@/components/PosBusinessSettingsView";
import { PosStoreClaimPanel } from "@/components/PosStoreClaimPanel";
import { PosTabletSyncPanel } from "@/components/PosTabletSyncPanel";

/**
 * หมวดจัดการ Pos — super slim
 * เรียงตามความถี่เปลี่ยน: เครื่อง → สัญญาณ → เข้างาน → ร้าน
 * เปิดหน้ามาพับทุกหมวด
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack pos-manage-stack--dense pos-manage-stack--slim pos-manage-stack--consolidated">
      <p className="muted pos-manage-lead">
        เครื่อง · สัญญาณ · เข้างาน · ร้าน — แตะหมวดเพื่อเปิด · พับเป็นค่าเริ่ม
      </p>

      {/* 1 — เปลี่ยนบ่อยสุด: ออนไลน์ / เวอร์ชัน / seat */}
      <NposDevicesPanel onError={onError} />

      {/* 2 — log / ตรวจ / แคป รวมหมวดเดียว */}
      <SettingsFold
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <Activity size={16} aria-hidden />
            สัญญาณ · ตรวจ · แคป
          </span>
        }
        hint="ops log · สเปกจอ · ไทม์ไลน์แคป — รวมในหมวดเดียว"
        defaultOpen={false}
        className="pos-manage-signal-fold"
      >
        <NposOpsLogPanel embedded onError={onError} />
        <NposDiagnosePanel embedded onError={onError} />
        <NposCaptureTimelinePanel embedded onError={onError} />
      </SettingsFold>

      {/* 3 — รหัสร้าน + ชีพจร (ตั้งค่านานๆ ครั้ง) */}
      <SettingsFold
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <KeyRound size={16} aria-hidden />
            เข้างาน · ชีพจร
          </span>
        }
        hint="รหัสร้าน · seat · ช่วงเช็คเซิร์ฟเวอร์"
        defaultOpen={false}
        className="pos-manage-access-fold"
      >
        <PosStoreClaimPanel embedded onError={onError} />
        <PosTabletSyncPanel embedded onError={onError} />
      </SettingsFold>

      {/* 4 — เปลี่ยนน้อยสุด: ชื่อร้าน / สลิป */}
      <SettingsFold
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <Store size={16} aria-hidden />
            ร้าน · สลิป
          </span>
        }
        hint="ชื่อ/ที่อยู่บนบิล · ตัวอย่างสลิป"
        defaultOpen={false}
        className="pos-manage-shop-fold"
      >
        <PosBusinessSettingsView embedded />
      </SettingsFold>
    </div>
  );
}
