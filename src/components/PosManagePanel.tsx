"use client";

import { SettingsFold } from "@/components/SettingsFold";
import { NposDiagnosePanel } from "@/components/NposDiagnosePanel";
import { NposDevicesPanel } from "@/components/NposDevicesPanel";
import { NposOpsLogPanel } from "@/components/NposOpsLogPanel";
import { NposCaptureTimelinePanel } from "@/components/NposCaptureTimelinePanel";
import { PosBusinessSettingsView } from "@/components/PosBusinessSettingsView";
import { PosStoreClaimPanel } from "@/components/PosStoreClaimPanel";
import { PosTabletSyncPanel } from "@/components/PosTabletSyncPanel";

/**
 * หมวดจัดการ Pos — compact · เปิดมาพับหมวด · ตัวอย่างสลิปเต็มพื้นที่ในตั้งค่าร้าน
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack pos-manage-stack--dense">
      <p className="muted pos-manage-lead">
        ตั้งชื่อ/ที่อยู่ → บันทึก Firebase · รหัสร้าน → แท็บเล็ตเคลม · seat ค้าง → เตะ
      </p>
      <SettingsFold
        title="ตั้งค่าร้าน · ตัวอย่างสลิป"
        hint="ชื่อ/ที่อยู่บนบิล · ดูตัวอย่างแบบพิมพ์เต็มพื้นที่"
        defaultOpen
        className="pos-manage-shop-fold"
      >
        <PosBusinessSettingsView embedded />
      </SettingsFold>
      <PosStoreClaimPanel onError={onError} />
      <PosTabletSyncPanel onError={onError} />
      <NposDevicesPanel onError={onError} />
      <NposCaptureTimelinePanel onError={onError} />
      <NposOpsLogPanel onError={onError} />
      <NposDiagnosePanel onError={onError} />
    </div>
  );
}
