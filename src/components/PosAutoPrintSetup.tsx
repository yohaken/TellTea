"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Printer } from "lucide-react";
import { getPosShopSettings, savePosShopSettings } from "@/lib/pos-settings";
import { getPosPrinterSetup, savePosPrinterSetup } from "@/lib/pos-printer";

export function PosAutoPrintSetup({ onError }: { onError: (msg: string | null) => void }) {
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(false);
  const [autoPrintBar, setAutoPrintBar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([getPosShopSettings(), getPosPrinterSetup()])
      .then(([shop, printers]) => {
        setAutoPrintReceipt(shop.autoPrintReceipt);
        setAutoPrintKitchen(printers.autoPrintKitchen);
        setAutoPrintBar(printers.autoPrintBar);
      })
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await Promise.all([
        savePosShopSettings({ autoPrintReceipt }),
        savePosPrinterSetup({ autoPrintKitchen, autoPrintBar }),
      ]);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Printer size={18} aria-hidden />
        พิมพ์หลังขาย
      </h2>
      <p className="muted settings-card-lead">
        เลือกเอกสารที่พิมพ์อัตโนมัติเมื่อขายสำเร็จ — ตั้งเครื่องพิมพ์แยกที่การ์ดด้านล่าง
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="pos-menu-form" onSubmit={(e) => void onSave(e)}>
          <div className="settings-mode-list" role="group" aria-label="พิมพ์หลังขาย">
            <label className={`settings-mode-option${autoPrintReceipt ? " is-active" : ""}`}>
              <input
                type="checkbox"
                checked={autoPrintReceipt}
                onChange={(e) => setAutoPrintReceipt(e.target.checked)}
              />
              <span className="settings-mode-copy">
                <strong>ใบเสร็จลูกค้า</strong>
                <span>พิมพ์สลิปแคชเชียร์หลังชำระเงิน</span>
              </span>
            </label>
            <label className={`settings-mode-option${autoPrintKitchen ? " is-active" : ""}`}>
              <input
                type="checkbox"
                checked={autoPrintKitchen}
                onChange={(e) => setAutoPrintKitchen(e.target.checked)}
              />
              <span className="settings-mode-copy">
                <strong>ใบสั่งครัว</strong>
                <span>ส่งไปเครื่องพิมพ์บทบาทครัว (Desktop 80mm)</span>
              </span>
            </label>
            <label className={`settings-mode-option${autoPrintBar ? " is-active" : ""}`}>
              <input
                type="checkbox"
                checked={autoPrintBar}
                onChange={(e) => setAutoPrintBar(e.target.checked)}
              />
              <span className="settings-mode-copy">
                <strong>ใบสั่งบาร์น้ำ</strong>
                <span>ส่งไปเครื่องพิมพ์บทบาทบาร์ (Desktop 80mm)</span>
              </span>
            </label>
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึกการพิมพ์"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
