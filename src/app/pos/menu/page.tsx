"use client";

import { PosHardLink } from "@/components/PosHardLink";

const BOH_MENU_URL = "https://telltea-shop.web.app/menu/";

/**
 * P5 cutover — จัดการเมนูย้ายไปหลังร้านแล้ว
 * คง route ไว้เพื่อ deep-link / smoke ไม่ให้ 404
 */
export default function PosMenuMovedPage() {
  return (
    <div className="pos-menu-moved">
      <h1>จัดการเมนูย้ายไปหลังร้านแล้ว</h1>
      <p className="muted">
        สร้าง · ลบ · ปรับแต่งเมนูที่ TellTea หลังร้าน — อื่นๆ → เมนู
      </p>
      <div className="pos-menu-moved-actions">
        <a className="primary-btn" href={BOH_MENU_URL} target="_blank" rel="noopener noreferrer">
          เปิดจัดการเมนูหลังร้าน
        </a>
        <PosHardLink href="/pos/sell/" className="ghost-btn">
          กลับหน้าขาย
        </PosHardLink>
      </div>
    </div>
  );
}
