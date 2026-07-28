"use client";

import { useState } from "react";

export function VatSalesOwnerGuide() {
  const [open, setOpen] = useState(false);
  return (
    <section className="vat-sales-settings vat-owner-guide">
      <button
        type="button"
        className="ghost-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "ซ่อนคู่มือสั้น" : "คู่มือสั้นสำหรับเจ้าของ"}
      </button>
      {open ? (
        <ol className="vat-owner-guide-list">
          <li>
            <strong>เชื่อมเมล</strong> — แท็บกล่องเมล · เชื่อม Gmail หรือ Outlook · กดซิงก์ ·
            Parse เมลที่รอ · ยืนยันยอดรายวันเข้าตาราง (เมลสัปดาห์/เดือนไปแท็บเทียบยอด)
          </li>
          <li>
            <strong>ยืนยันวัน</strong> — แท็บตารางรายวัน · ตรวจสถานะ “พร้อมยืนยัน” · กดยืนยันทีละวัน
            หรือยืนยันทั้งวันที่พร้อม · หน้าร้านดึงจาก POS ได้
          </li>
          <li>
            <strong>ปิดเดือน</strong> — แท็บปิดเดือน / VAT · ตรวจ VAT ขาย vs ภาษีซื้อ ·
            ใส่ยอดเป็นรายได้เดือนในสรุปรายเดือน (P&amp;L)
          </li>
        </ol>
      ) : null}
    </section>
  );
}
