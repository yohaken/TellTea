"use client";

import { UtensilsCrossed } from "lucide-react";
import { MenuCatalogSetup } from "@/components/MenuCatalogSetup";

/**
 * หมวดจัดการ Pos — เหลือแค่เมนูเปิด/ปิด (native เป็นหลัก)
 * ไม่โชว์อุปกรณ์เว็บ / ลิงก์ร้าน / สลิป / เครื่องพิมพ์ ที่ผูก POS เว็บแอพเดิม
 * (โค้ดเว็บ POS ยังอยู่บน telltea-pos จนกว่าจะโยก native ครบ)
 */
export function PosManagePanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead">
        <UtensilsCrossed size={16} aria-hidden style={{ verticalAlign: "-0.2em", marginRight: "0.3rem" }} />
        เปิด-ปิดเมนูหน้าร้าน · เพิ่มหมวด/รายการด่วน — ใช้ร่วมกับแอป native
      </p>
      <MenuCatalogSetup onError={onError} />
    </div>
  );
}
