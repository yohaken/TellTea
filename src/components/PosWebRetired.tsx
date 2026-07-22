"use client";

import { POS_APK_INSTALL_PAGE_URL } from "@/lib/pos-url";

const POS_SALES_URL = "https://telltea-shop.web.app/pos-sales/";
const MENU_URL = "https://telltea-shop.web.app/menu/";

/**
 * เว็บ POS เคาน์เตอร์เลิกใช้แล้ว — ขายบน nPos · รายงาน/ตั้งค่าอยู่หลังร้าน
 */
export function PosWebRetired({
  title = "เว็บ POS เลิกใช้แล้ว",
}: {
  title?: string;
}) {
  return (
    <main className="pos-menu-moved pos-web-retired">
      <h1>{title}</h1>
      <p className="muted">
        ขาย · บิลค้าง · ใบเสร็จ · กะ · ตั้งค่าเครื่อง — ใช้แอป <strong>nPos-telltea</strong> บนแท็บเล็ต
      </p>
      <p className="muted">
        รายงานยอดขายและตั้งค่าร้าน (หัวบิล · PromptPay · เรียงเมนู) อยู่หลังร้าน — POS
      </p>
      <div className="pos-menu-moved-actions">
        <a className="primary-btn" href={POS_APK_INSTALL_PAGE_URL}>
          ติดตั้ง / อัปเดต nPos
        </a>
        <a className="ghost-btn" href={POS_SALES_URL}>
          เปิดรายงาน POS หลังร้าน
        </a>
        <a className="ghost-btn" href={MENU_URL}>
          จัดการเมนูหลังร้าน
        </a>
      </div>
    </main>
  );
}
