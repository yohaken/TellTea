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
          เมล→วัน→ยืนยัน→ปิดเดือน · VAT7% จากยอดลูกค้า · owner only
        </span>
      </p>
      {open ? (
        <ul className="vat-map-list">
          <li>
            <b>วัน</b> ตาราง Sp/Grab/LM + หน้าร้าน · ยืนยันวัน
          </li>
          <li>
            <b>เมล</b> Gmail/Outlook · ซิงก์ · parse · ยืนยันเข้าวัน
          </li>
          <li>
            <b>เทียบ</b> สรุปสัปดาห์/เดือน vs รวมวัน (ไม่ทับ)
          </li>
          <li>
            <b>ซื้อ</b> ใบกำกับ · ภาษีซื้อ
          </li>
          <li>
            <b>ปิด</b> ใส่รายได้→P&amp;L · VAT สุทธิ
          </li>
          <li>
            <b>ประวัติ</b> audit แก้/ยืนยัน/ปิด
          </li>
        </ul>
      ) : null}
    </div>
  );
}
