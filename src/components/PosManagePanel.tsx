"use client";

import { MonitorSmartphone } from "lucide-react";
import { MenuCatalogSetup } from "@/components/MenuCatalogSetup";
import { PosDeviceSetup } from "@/components/PosDeviceSetup";
import { PosOpsNotesSetup } from "@/components/PosOpsNotesSetup";
import { PosPrinterSetup } from "@/components/PosPrinterSetup";
import { PosShopPaySetup } from "@/components/PosShopPaySetup";

/** หมวดจัดการ Pos — รวมตั้งค่าที่เคยอยู่หน้า ตั้งค่าโมดูล */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        <MonitorSmartphone size={16} aria-hidden style={{ verticalAlign: "-0.2em", marginRight: "0.3rem" }} />
        เครื่อง · ลิงก์ร้าน · สลิป/ชำระเงิน · เครื่องพิมพ์ · เมนูหน้าร้าน
      </p>
      <PosDeviceSetup onError={onError} />
      <PosOpsNotesSetup onError={onError} />
      <PosShopPaySetup onError={onError} />
      <PosPrinterSetup onError={onError} />
      <MenuCatalogSetup onError={onError} />
    </div>
  );
}
