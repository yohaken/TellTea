"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QrCode } from "lucide-react";
import { getPosShopSettings, savePosShopSettings } from "@/lib/pos-settings";
import { maskPromptPayId } from "@/lib/pos-promptpay";

export function PosPaymentSetup({ onError }: { onError: (msg: string | null) => void }) {
  const [shopName, setShopName] = useState("TELL TEA");
  const [shopNameTh, setShopNameTh] = useState("เทล ที");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");
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
      await savePosShopSettings({
        shopName,
        shopNameTh,
        shopAddress,
        shopPhone,
        promptPayId,
        autoPrintReceipt,
      });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <QrCode size={18} aria-hidden />
        ชำระเงิน POS
      </h2>
      <p className="muted settings-card-lead">
        ข้อมูลบนสลิปใบเสร็จรูปแบบเดียว · PromptPay สำหรับสแกนจ่ายบนแท็บเล็ต
        {promptPayId ? ` · ${maskPromptPayId(promptPayId)}` : ""}
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="pos-menu-form" onSubmit={(e) => void onSave(e)}>
          <label>
            <span>ชื่อร้าน (อังกฤษ)</span>
            <input value={shopName} onChange={(e) => setShopName(e.target.value)} required />
          </label>
          <label>
            <span>ชื่อร้าน (ไทย)</span>
            <input value={shopNameTh} onChange={(e) => setShopNameTh(e.target.value)} placeholder="เทล ที" />
          </label>
          <label>
            <span>ที่อยู่ (บนสลิป)</span>
            <textarea
              value={shopAddress}
              onChange={(e) => setShopAddress(e.target.value)}
              rows={2}
              placeholder="ถ.… ต.… อ.… จ.…"
            />
          </label>
          <label>
            <span>โทรศัพท์</span>
            <input
              value={shopPhone}
              onChange={(e) => setShopPhone(e.target.value)}
              placeholder="08xxxxxxxx"
              inputMode="tel"
            />
          </label>
          <label>
            <span>เลข PromptPay</span>
            <input
              value={promptPayId}
              onChange={(e) => setPromptPayId(e.target.value)}
              placeholder="เบอร์ 08xxxxxxxx หรือเลขผู้เสียภาษี"
              inputMode="numeric"
            />
          </label>
          <label className="pos-settings-check">
            <input
              type="checkbox"
              checked={autoPrintReceipt}
              onChange={(e) => setAutoPrintReceipt(e.target.checked)}
            />
            <span>พิมพ์ใบเสร็จอัตโนมัติหลังขายสำเร็จ</span>
          </label>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
