"use client";

import { Package } from "lucide-react";

/** Counter stub — stock/BO is owner-only; no link out of POS. */
export function PosInventoryView() {
  return (
    <div className="pos-module">
      <div className="pos-module-content pos-module-empty">
        <Package size={48} aria-hidden />
        <h2>สินค้าคงคลัง</h2>
        <p className="muted">
          สต็อกจัดการที่หลังร้านเท่านั้น · เคาน์เตอร์ POS ไม่เปิดลิงก์ออกไปหลังร้าน
        </p>
      </div>
    </div>
  );
}
