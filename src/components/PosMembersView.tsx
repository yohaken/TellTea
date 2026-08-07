"use client";

import { CreditCard } from "lucide-react";

export function PosMembersView() {
  return (
    <div className="pos-module">
      <div className="pos-module-content pos-module-empty">
        <CreditCard size={48} aria-hidden />
        <h2>บัตรสมาชิก</h2>
        <p className="muted">จัดการสมาชิก/แต้มอยู่ที่หลังร้านแล้ว (อื่นๆ → สมาชิก / แต้ม)</p>
        <p className="muted">ผูกบิลและสะสมแต้มบนเคาน์เตอร์ — เฟส M2</p>
      </div>
    </div>
  );
}
