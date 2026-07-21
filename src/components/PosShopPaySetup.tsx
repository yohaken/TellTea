"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QrCode, Store } from "lucide-react";
import { getPosShopSettings, savePosShopSettings } from "@/lib/pos-settings";
import { isValidPromptPayId, maskPromptPayId, normalizePromptPayId } from "@/lib/pos-promptpay";

/** ข้อมูลร้านบนสลิป + PromptPay — การ์ดเดียว (แทนแยก 2 การ์ด) */
export function PosShopPaySetup({ onError }: { onError: (msg: string | null) => void }) {
  const [shopName, setShopName] = useState("TELL TEA");
  const [shopNameTh, setShopNameTh] = useState("เทล ที");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [receiptStaffName, setReceiptStaffName] = useState("หน้าร้าน");
  const [receiptFooterNote, setReceiptFooterNote] = useState("ขอบคุณที่อุดหนุน");
  const [promptPayId, setPromptPayId] = useState("");
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
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
        setPromptPayId(s.promptPayId);
        setAutoPrintReceipt(s.autoPrintReceipt);
      })
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const normalized = normalizePromptPayId(promptPayId);
      if (normalized && !isValidPromptPayId(normalized)) {
        onError("เลข PromptPay ไม่ถูกต้อง — ใช้เบอร์ 10 หลัก (0…) หรือเลขภาษี 13 หลัก");
        return;
      }
      await savePosShopSettings({
        shopName,
        shopNameTh,
        shopAddress,
        shopPhone,
        receiptStaffName,
        receiptFooterNote,
        promptPayId: normalized,
        autoPrintReceipt,
      });
      setPromptPayId(normalized);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="settings-card">
        <p className="muted">กำลังโหลดข้อมูลร้าน...</p>
      </section>
    );
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Store size={18} aria-hidden />
        ร้าน · สลิป · ชำระเงิน
      </h2>
      <p className="muted settings-card-lead">
        หัวบิล + PromptPay · แท็บเล็ตแก้ได้ที่เมนู &quot;ตั้งค่ากิจการ&quot;
        {isValidPromptPayId(promptPayId) ? ` · พร้อม (${maskPromptPayId(promptPayId)})` : ""}
      </p>
      <form className="form-card" onSubmit={(e) => void onSave(e)}>
        <p className="settings-subhead">
          <Store size={14} aria-hidden /> บนสลิป
        </p>
        <div className="field">
          <label htmlFor="pos-shop-name">ชื่อร้าน (EN)</label>
          <input
            id="pos-shop-name"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            required
            autoComplete="organization"
          />
        </div>
        <div className="field">
          <label htmlFor="pos-shop-name-th">ชื่อร้าน (ไทย)</label>
          <input
            id="pos-shop-name-th"
            value={shopNameTh}
            onChange={(e) => setShopNameTh(e.target.value)}
            placeholder="เทล ที"
          />
        </div>
        <div className="field">
          <label htmlFor="pos-shop-address">ที่อยู่บนบิล</label>
          <textarea
            id="pos-shop-address"
            value={shopAddress}
            onChange={(e) => setShopAddress(e.target.value)}
            rows={2}
            placeholder="ถ.… ต.… อ.… จ.…"
          />
        </div>
        <div className="field">
          <label htmlFor="pos-shop-phone">โทรศัพท์</label>
          <input
            id="pos-shop-phone"
            value={shopPhone}
            onChange={(e) => setShopPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
        <div className="field">
          <label htmlFor="pos-receipt-staff">พนักงานบนบิล</label>
          <input
            id="pos-receipt-staff"
            value={receiptStaffName}
            onChange={(e) => setReceiptStaffName(e.target.value)}
            placeholder="หน้าร้าน"
          />
        </div>
        <div className="field">
          <label htmlFor="pos-receipt-footer">ข้อความท้ายสลิป</label>
          <input
            id="pos-receipt-footer"
            value={receiptFooterNote}
            onChange={(e) => setReceiptFooterNote(e.target.value)}
            placeholder="ขอบคุณที่อุดหนุน"
          />
        </div>

        <p className="settings-subhead">
          <QrCode size={14} aria-hidden /> PromptPay
        </p>
        <div className="field">
          <label htmlFor="pos-promptpay">เลข PromptPay</label>
          <input
            id="pos-promptpay"
            value={promptPayId}
            onChange={(e) => setPromptPayId(e.target.value)}
            placeholder="เบอร์ 08xxxxxxxx หรือเลขผู้เสียภาษี 13 หลัก"
            inputMode="numeric"
          />
        </div>
        <label className="check-row" style={{ marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            checked={autoPrintReceipt}
            onChange={(e) => setAutoPrintReceipt(e.target.checked)}
          />
          <span>พิมพ์ใบเสร็จอัตโนมัติหลังขาย</span>
        </label>

        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกร้านและชำระเงิน"}
        </button>
      </form>
    </section>
  );
}
