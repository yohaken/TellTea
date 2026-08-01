"use client";

/**
 * ที่มายอดเดลิเวอรี่ — พักทั้งหน้า
 * รื้อ UI/ไหลเดิม (Drive slot · รางแอพ · F0–F5) ออกแล้ว
 * รอออกแบบทางใหม่แล้วค่อยสร้างใหม่
 */
import Link from "next/link";

type Props = { actor: string };

export function VatDeliverySources({ actor: _actor }: Props) {
  return (
    <section
      className="vat-table-block vat-sources-paused"
      id="vat-delivery-sources"
      data-ai-context="vat-delivery-sources-paused"
      aria-label="ที่มายอดเดลิเวอรี่ — พักออกแบบใหม่"
    >
      <h2 className="vat-table-title">ที่มายอดเดลิเวอรี่</h2>
      <p className="muted vat-sales-hint">
        หน้านี้ถูกรื้อออกแล้ว — ทางเดิมไม่ใช้ต่อ รอออกแบบวิธีใหม่
      </p>
      <p className="vat-sources-paused-body">
        ไม่มีตาราง · ไม่มีซิงก์ Drive · ไม่มีร่างยอดบนหน้านี้ชั่วคราว
        <br />
        ปิดงบเดลิเวอรี่ชั่วคราวใช้หน้า{" "}
        <Link href="/vat-sales/">VAT เดือน</Link> ไปก่อน
      </p>
    </section>
  );
}
