"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Store } from "lucide-react";
import { getPosShopSettings, savePosShopSettings } from "@/lib/pos-settings";

export function PosShopInfoSetup({ onError }: { onError: (msg: string | null) => void }) {
  const [shopName, setShopName] = useState("TELL TEA");
  const [shopNameTh, setShopNameTh] = useState("เทล ที");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [receiptStaffName, setReceiptStaffName] = useState("หน้าร้าน");
  const [receiptFooterNote, setReceiptFooterNote] = useState("ขอบคุณที่อุดหนุน");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPosShopSettings()
      .then((s) => {
        setShopName(s.shopName);
        setShopNameTh(s.shopNameTh);
        setShopAddress(s.shopAddress);
        setShopPhone(s.shopPhone);
        setReceiptStaffName(s.receiptStaffName);
        setReceiptFooterNote(s.receiptFooterNote);
      })
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await savePosShopSettings({
        shopName,
        shopNameTh,
        shopAddress,
        shopPhone,
        receiptStaffName,
        receiptFooterNote,
      });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card pos-shop-info-card">
      <h2 className="settings-card-title pos-shop-info-title">
        <Store size={18} aria-hidden />
        ข้อมูลร้านบนสลิป
      </h2>
      <p className="muted settings-card-lead">
        ชื่อร้าน · ที่อยู่ · พนักงาน — แสดงบนใบเสร็จและตอนพิมพ์
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="pos-shop-info-form" onSubmit={(e) => void onSave(e)}>
          <div className="pos-shop-info-grid">
            <label>
              <span>ชื่อร้าน (EN)</span>
              <input value={shopName} onChange={(e) => setShopName(e.target.value)} required />
            </label>
            <label>
              <span>ชื่อร้าน (ไทย)</span>
              <input value={shopNameTh} onChange={(e) => setShopNameTh(e.target.value)} placeholder="เทล ที" />
            </label>
            <label className="pos-shop-info-span2">
              <span>ที่อยู่บนสลิป</span>
              <textarea
                value={shopAddress}
                onChange={(e) => setShopAddress(e.target.value)}
                rows={2}
                placeholder="ถ.… ต.… อ.… จ.…"
              />
            </label>
            <label>
              <span>โทรศัพท์</span>
              <input value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} inputMode="tel" />
            </label>
            <label>
              <span>ชื่อพนักงานบนบิล</span>
              <input
                value={receiptStaffName}
                onChange={(e) => setReceiptStaffName(e.target.value)}
                placeholder="หน้าร้าน"
              />
            </label>
            <label className="pos-shop-info-span2">
              <span>ข้อความท้ายสลิป</span>
              <input
                value={receiptFooterNote}
                onChange={(e) => setReceiptFooterNote(e.target.value)}
                placeholder="ขอบคุณที่อุดหนุน"
              />
            </label>
          </div>
          <button type="submit" className="primary-btn pos-shop-info-save" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึกข้อมูลร้าน"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
