"use client";

import { CreditCard } from "lucide-react";

export function PosMembersView() {
  return (
    <div className="pos-module">
      <div className="pos-module-content pos-module-empty">
        <CreditCard size={48} aria-hidden />
        <h2>บัตรสมาชิก</h2>
        <p className="muted">ระบบสะสมแต้ม — กำลังพัฒนา</p>
        <p className="muted">เพิ่มบัตรสะสมคะแนนจะอยู่ที่หน้าขายเมื่อพร้อมใช้งาน</p>
      </div>
    </div>
  );
}
