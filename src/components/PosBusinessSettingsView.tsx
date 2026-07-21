"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  getLocalPosShopSettings,
  savePosShopSettings,
  subscribePosShopSettings,
  type PosShopSettings,
} from "@/lib/pos-settings";
import {
  getPosPrinterSetup,
  savePosPrinterSetup,
  subscribePosPrinterSetup,
} from "@/lib/pos-printer";
import { isValidPromptPayId, maskPromptPayId, normalizePromptPayId } from "@/lib/pos-promptpay";
import { usePosApp } from "@/lib/pos-app-context";
import { posVersionLabel } from "@/lib/pos-version";

type Tab = "bill" | "pay";

function BillPreview({ shop }: { shop: PosShopSettings }) {
  return (
    <aside className="pos-biz-preview" aria-label="ตัวอย่างหัวบิล">
      <p className="pos-biz-preview-label">ตัวอย่างบนบิล</p>
      <div className="pos-biz-preview-slip">
        <strong className="pos-biz-preview-name">{shop.shopName || "—"}</strong>
        {shop.shopNameTh ? <span className="pos-biz-preview-th">{shop.shopNameTh}</span> : null}
        {shop.shopAddress ? <span className="pos-biz-preview-line">{shop.shopAddress}</span> : null}
        {shop.shopPhone ? <span className="pos-biz-preview-line">โทร {shop.shopPhone}</span> : null}
        <hr className="pos-biz-preview-rule" />
        <span className="pos-biz-preview-meta">พนักงาน: {shop.receiptStaffName || "—"}</span>
        <span className="pos-biz-preview-foot">{shop.receiptFooterNote || ""}</span>
      </div>
    </aside>
  );
}

export function PosBusinessSettingsView() {
  const { setError } = usePosApp();
  const [tab, setTab] = useState<Tab>("bill");
  const [shopName, setShopName] = useState("");
  const [shopNameTh, setShopNameTh] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [receiptStaffName, setReceiptStaffName] = useState("");
  const [receiptFooterNote, setReceiptFooterNote] = useState("");
  const [promptPayId, setPromptPayId] = useState("");
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(false);
  const [autoPrintBar, setAutoPrintBar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const applySettings = useCallback((s: PosShopSettings) => {
    setShopName(s.shopName);
    setShopNameTh(s.shopNameTh);
    setShopAddress(s.shopAddress);
    setShopPhone(s.shopPhone);
    setReceiptStaffName(s.receiptStaffName);
    setReceiptFooterNote(s.receiptFooterNote);
    setPromptPayId(s.promptPayId);
    setAutoPrintReceipt(s.autoPrintReceipt);
  }, []);

  useEffect(() => {
    applySettings(getLocalPosShopSettings());
    return subscribePosShopSettings(applySettings);
  }, [applySettings]);

  useEffect(() => {
    void getPosPrinterSetup()
      .then((setup) => {
        setAutoPrintKitchen(setup.autoPrintKitchen);
        setAutoPrintBar(setup.autoPrintBar);
      })
      .catch(() => {
        /* keep defaults */
      });
    return subscribePosPrinterSetup((setup) => {
      setAutoPrintKitchen(setup.autoPrintKitchen);
      setAutoPrintBar(setup.autoPrintBar);
    });
  }, []);

  const draftPreview: PosShopSettings = {
    shopName,
    shopNameTh,
    shopAddress,
    shopPhone,
    promptPayId,
    autoPrintReceipt,
    receiptStaffName,
    receiptFooterNote,
  };

  async function saveBill(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await savePosShopSettings({
        shopName,
        shopNameTh,
        shopAddress,
        shopPhone,
        receiptStaffName,
        receiptFooterNote,
      });
      setSavedMsg(
        result.synced
          ? "บันทึกแล้ว · อัปขึ้น Firebase แล้ว"
          : "บันทึกในเครื่องแล้ว · จะอัปขึ้น Firebase ทีหลัง",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePay(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const normalized = normalizePromptPayId(promptPayId);
      if (normalized && !isValidPromptPayId(normalized)) {
        setError("เลข PromptPay ไม่ถูกต้อง — ใช้เบอร์ 10 หลัก (0…) หรือเลขภาษี 13 หลัก");
        return;
      }
      const [result] = await Promise.all([
        savePosShopSettings({
          promptPayId: normalized,
          autoPrintReceipt,
        }),
        savePosPrinterSetup({
          autoPrintKitchen,
          autoPrintBar,
        }),
      ]);
      setPromptPayId(normalized);
      setSavedMsg(
        result.synced
          ? normalized
            ? "PromptPay + พิมพ์หลังขาย · อัป Firebase แล้ว"
            : "บันทึกแล้ว · อัปขึ้น Firebase แล้ว"
          : normalized
            ? "PromptPay พร้อมใช้ในเครื่อง · จะอัป Firebase ทีหลัง"
            : "บันทึกในเครื่องแล้ว · จะอัป Firebase ทีหลัง",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-module pos-biz-module">
      <div className="pos-module-subnav pos-biz-subnav">
        <button type="button" className={tab === "bill" ? "is-active" : ""} onClick={() => setTab("bill")}>
          บนบิล
        </button>
        <button type="button" className={tab === "pay" ? "is-active" : ""} onClick={() => setTab("pay")}>
          ชำระเงิน
        </button>
        <span className="pos-biz-version muted">{posVersionLabel()}</span>
      </div>

      <div className="pos-module-content pos-biz-content">
        {savedMsg ? <p className="ok-text pos-biz-saved">{savedMsg}</p> : null}

        {tab === "bill" ? (
          <div className="pos-biz-layout">
            <form className="pos-biz-form" onSubmit={(e) => void saveBill(e)}>
              <p className="muted pos-biz-lead">
                ชื่อ · ที่อยู่ · โทร — แสดงหัวใบเสร็จและสรุปกะ · บันทึกในเครื่องก่อน แล้วค่อยอัป Firebase
              </p>
              <div className="pos-biz-grid">
                <label>
                  <span>ชื่อร้าน (EN)</span>
                  <input
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    required
                    autoComplete="organization"
                  />
                </label>
                <label>
                  <span>ชื่อร้าน (ไทย)</span>
                  <input
                    value={shopNameTh}
                    onChange={(e) => setShopNameTh(e.target.value)}
                    placeholder="เทล ที"
                  />
                </label>
                <label className="pos-biz-span2">
                  <span>ที่อยู่บนบิล</span>
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
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </label>
                <label>
                  <span>พนักงานบนบิล</span>
                  <input
                    value={receiptStaffName}
                    onChange={(e) => setReceiptStaffName(e.target.value)}
                    placeholder="หน้าร้าน"
                  />
                </label>
                <label className="pos-biz-span2">
                  <span>ข้อความท้ายสลิป</span>
                  <input
                    value={receiptFooterNote}
                    onChange={(e) => setReceiptFooterNote(e.target.value)}
                    placeholder="ขอบคุณที่อุดหนุน"
                  />
                </label>
              </div>
              <button type="submit" className="pos-btn-orange pos-biz-save" disabled={busy}>
                {busy ? "กำลังบันทึก..." : "บันทึกบนบิล"}
              </button>
            </form>
            <BillPreview shop={draftPreview} />
          </div>
        ) : (
          <form className="pos-biz-form pos-biz-form--pay" onSubmit={(e) => void savePay(e)}>
            <p className="muted pos-biz-lead">
              PromptPay พร้อมใช้แบบสแกน QR + พิมพ์หลังขาย
              {isValidPromptPayId(promptPayId)
                ? ` · พร้อม (${maskPromptPayId(promptPayId)})`
                : " · ตั้งเลขด้านล่างก่อนขาย"}
            </p>
            <div className="pos-biz-grid pos-biz-grid--pay">
              <label className="pos-biz-span2">
                <span>เลข PromptPay</span>
                <input
                  value={promptPayId}
                  onChange={(e) => setPromptPayId(e.target.value)}
                  placeholder="เบอร์ 08xxxxxxxx หรือเลขผู้เสียภาษี 13 หลัก"
                  inputMode="numeric"
                />
              </label>
              <label className="pos-biz-check pos-biz-span2">
                <input
                  type="checkbox"
                  checked={autoPrintReceipt}
                  onChange={(e) => setAutoPrintReceipt(e.target.checked)}
                />
                <span>พิมพ์ใบเสร็จลูกค้าหลังขาย</span>
              </label>
              <label className="pos-biz-check pos-biz-span2">
                <input
                  type="checkbox"
                  checked={autoPrintKitchen}
                  onChange={(e) => setAutoPrintKitchen(e.target.checked)}
                />
                <span>พิมพ์ใบสั่งครัวหลังขาย</span>
              </label>
              <label className="pos-biz-check pos-biz-span2">
                <input
                  type="checkbox"
                  checked={autoPrintBar}
                  onChange={(e) => setAutoPrintBar(e.target.checked)}
                />
                <span>พิมพ์ใบสั่งบาร์น้ำหลังขาย</span>
              </label>
            </div>
            <button type="submit" className="pos-btn-orange pos-biz-save" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึกชำระเงิน"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
