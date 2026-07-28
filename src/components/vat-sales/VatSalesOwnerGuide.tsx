"use client";

import { useState } from "react";

/** ภาพรวมระบบแบบย่อ — กดขยายถ้าต้องการ */
export function VatSalesOwnerGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="vat-map">
      <p className="vat-map-line muted">
        <button
          type="button"
          className="vat-map-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "ซ่อนแผน" : "แผน"}
        </button>
        <span>
          เมล→วัน→ยืนยัน→ปิดที่ /pnl/ · VAT7% · owner only · เช็ค docs/vat-p*-check.md
        </span>
      </p>
      {open ? (
        <ul className="vat-map-list">
          <li>
            <b>วัน</b> ตาราง Sp/G/LM + ร้าน · ยืนยันวัน
          </li>
          <li>
            <b>เมล</b> Gmail · ซิงก์ · parse · ยืนยันเข้าวัน (อีเมลอื่น forward เข้า Gmail)
          </li>
          <li>
            <b>เทียบ</b> สัปดาห์/เดือน vs รวมวัน (ไม่ทับ) · นับวันยืนยันได้
          </li>
          <li>
            <b>ซื้อ</b> ใบกำกับ · ภาษีซื้อ
          </li>
          <li>
            <b>ปิด</b> หรือแผงบน <b>/pnl/</b> ใส่รายได้
          </li>
          <li>
            <b>ประวัติ</b> audit · prune raw ในเมล
          </li>
        </ul>
      ) : null}
    </div>
  );
}
