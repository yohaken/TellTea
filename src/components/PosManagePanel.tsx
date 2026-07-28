"use client";

import { Activity, Settings2 } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";
import { NposOpsLogPanel } from "@/components/NposOpsLogPanel";
import { NposCaptureTimelinePanel } from "@/components/NposCaptureTimelinePanel";
import { PosBusinessSettingsView } from "@/components/PosBusinessSettingsView";
import { PosStoreClaimPanel } from "@/components/PosStoreClaimPanel";
import { PosTabletSyncPanel } from "@/components/PosTabletSyncPanel";

/**
 * หมวดจัดการ Pos — super slim (3 หมวด)
 * เรียงตามความถี่: เครื่อง → สัญญาณ → ตั้งค่า
 * เปิดหน้ามาพับทุกหมวด
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack pos-manage-stack--dense pos-manage-stack--slim pos-manage-stack--consolidated">
      <p className="muted pos-manage-lead">
        เครื่อง · สัญญาณ · ตั้งค่า — แตะหมวดเพื่อเปิด · พับเป็นค่าเริ่ม · โฟกัส 570F0F
      </p>

      {/* 1 — เปลี่ยนบ่อยสุด */}
      <NposDevicesPanel onError={onError} />

      {/* 2 — log / ตรวจ / แคป */}
      <SettingsFold
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <Activity size={16} aria-hidden />
            สัญญาณ · ตรวจ · แคป
          </span>
        }
        hint="ops · สเปกจอ · แคป"
        defaultOpen={false}
        className="pos-manage-signal-fold"
      >
        <NposOpsLogPanel embedded onError={onError} />
        <NposDiagnosePanel embedded onError={onError} />
        <NposCaptureTimelinePanel embedded onError={onError} />
      </SettingsFold>

      {/* 3 — รหัสร้าน + ชีพจร + ร้าน/สลิป รวมหมวดตั้งค่า */}
      <SettingsFold
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <Settings2 size={16} aria-hidden />
            ตั้งค่า
          </span>
        }
        hint="รหัสร้าน · ชีพจร · ชื่อร้าน/สลิป"
        defaultOpen={false}
        className="pos-manage-settings-fold"
      >
        <PosStoreClaimPanel embedded onError={onError} />
        <PosTabletSyncPanel embedded onError={onError} />
        <PosBusinessSettingsView embedded />
      </SettingsFold>
    </div>
  );
}
