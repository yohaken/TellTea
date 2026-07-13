"use client";

import { Package } from "lucide-react";

export function PosInventoryView() {
  return (
    <div className="pos-module">
      <div className="pos-module-subnav">
        <button type="button" className="is-active">
          รายการสินค้าคงคลัง
        </button>
        <button type="button" disabled>
          จัดสูตรเมนู
        </button>
        <button type="button" disabled>
          ประวัติ
        </button>
      </div>
      <div className="pos-module-content pos-module-empty">
        <Package size={48} aria-hidden />
        <h2>สินค้าคงคลัง</h2>
        <p className="muted">จัดการวัตถุดิบและสต็อกที่ TellTea หลังร้าน → สต็อก</p>
        <a href="https://mypeer-501909.web.app/stock/" className="ghost-btn" target="_blank" rel="noreferrer">
          เปิดหลังร้าน
        </a>
      </div>
    </div>
  );
}
