"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  flushPosShopSettingsUpload,
  getLocalPosShopSettings,
  isPosShopSettingsSyncPending,
  savePosShopSettings,
  setPosSettingsDbMode,
  subscribePosShopSettings,
  type PosShopSettings,
} from "@/lib/pos-settings";
import { isValidPromptPayId, maskPromptPayId, normalizePromptPayId } from "@/lib/pos-promptpay";
import { posVersionLabel } from "@/lib/pos-version";
import {
  applyShopToReceiptSample,
  buildShiftReportHtml,
  buildUnifiedReceiptBody,
  getKindProfile,
  sampleReceiptCases,
  sampleShiftReportPayload,
  unifiedReceiptStyles,
  type SampleReceiptCaseId,
} from "@/lib/pos-printer";

type Tab = "bill" | "pay" | "menu";
type PreviewDoc = "receipt" | "x" | "z";

function stripPrintScripts(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function DocPreview({ shop }: { shop: PosShopSettings }) {
  const cases = useMemo(() => sampleReceiptCases(), []);
  const [doc, setDoc] = useState<PreviewDoc>("receipt");
  const [caseId, setCaseId] = useState<SampleReceiptCaseId>("cash_change");

  const html = useMemo(() => {
    if (doc === "receipt") {
      const sample = cases.find((c) => c.id === caseId)?.payload ?? cases[0]!.payload;
      const payload = applyShopToReceiptSample(sample, shop);
      const layout = getKindProfile("desktop_80");
      const body = buildUnifiedReceiptBody(payload, layout);
      const css = unifiedReceiptStyles(layout, "auto");
      return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/><style>${css}
        body{margin:0;background:#fff;}
      </style></head><body>${body}</body></html>`;
    }
    const kind = doc === "x" ? "snapshot" : "close";
    return stripPrintScripts(buildShiftReportHtml(sampleShiftReportPayload(kind, shop)));
  }, [cases, caseId, doc, shop]);

  return (
    <aside className="pos-biz-preview pos-biz-preview--print" aria-label="ตัวอย่างเอกสาร">
      <div className="pos-biz-preview-toolbar">
        <div className="pos-biz-preview-tabs" role="tablist">
          {(
            [
              ["receipt", "ใบเสร็จ"],
              ["x", "X"],
              ["z", "Z"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={doc === id}
              className={doc === id ? "is-active" : ""}
              onClick={() => setDoc(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {doc === "receipt" ? (
          <div className="pos-biz-preview-cases">
            {cases.map((c) => (
              <button
                key={c.id}
                type="button"
                className={caseId === c.id ? "is-active" : ""}
                onClick={() => setCaseId(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="pos-biz-preview-hint muted">
            {doc === "x" ? "กลางรอบ" : "ปิดรอบ"} · ฟอร์มเดียวกับพิมพ์
          </p>
        )}
      </div>
      <div className="pos-biz-preview-frame-wrap">
        <iframe
          className="pos-biz-preview-frame"
          title="ตัวอย่างเอกสาร"
          sandbox=""
          srcDoc={html}
        />
      </div>
    </aside>
  );
}

export function PosBusinessSettingsView({
  embedded = false,
}: {
  /** ฝังในหลังร้าน /pos-sales/ — ใช้ Google owner auth */
  embedded?: boolean;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const setError = setLocalError;
  const [tab, setTab] = useState<Tab>("bill");
  const [shopName, setShopName] = useState("");
  const [shopNameTh, setShopNameTh] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [receiptStaffName, setReceiptStaffName] = useState("");
  const [receiptFooterNote, setReceiptFooterNote] = useState("");
  const [promptPayId, setPromptPayId] = useState("");
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [menuArrangeMode, setMenuArrangeMode] = useState<"fix" | "bestsellers">("fix");
  const [bestsellerWindowDays, setBestsellerWindowDays] = useState(7);
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
    setMenuArrangeMode(s.menuArrangeMode);
    setBestsellerWindowDays(s.bestsellerWindowDays);
  }, []);

  useEffect(() => {
    if (embedded) setPosSettingsDbMode("owner");
    applySettings(getLocalPosShopSettings());
    const unsub = subscribePosShopSettings(applySettings, (err) => setError(err.message));
    return () => {
      unsub();
      // Keep owner mode until pending upload finishes — flipping to pos mid-flush
      // used to fail silently and leave Firebase with the old address.
      if (embedded) {
        void (async () => {
          try {
            if (isPosShopSettingsSyncPending()) {
              await flushPosShopSettingsUpload("owner");
            }
          } finally {
            setPosSettingsDbMode("pos");
          }
        })();
      }
    };
  }, [applySettings, embedded]);

  const draftPreview: PosShopSettings = {
    shopName,
    shopNameTh,
    shopAddress,
    shopPhone,
    promptPayId,
    autoPrintReceipt,
    receiptStaffName,
    receiptFooterNote,
    menuArrangeMode,
    bestsellerWindowDays,
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
      if (!result.synced && embedded) {
        setError(
          result.syncError ||
            "บันทึกขึ้น Firebase ไม่สำเร็จ — ที่อยู่บนบิลแท็บเล็ตจะไม่เปลี่ยนจนกว่าจะอัปได้",
        );
        setSavedMsg("บันทึกในเครื่องแล้ว · ยังไม่ขึ้น Firebase");
      } else {
        setSavedMsg(
          result.synced
            ? "บันทึกแล้ว · อัปขึ้น Firebase แล้ว — แท็บเล็ตดึงค่าใหม่ตอนรีเฟรช/เปิดขาย"
            : "บันทึกในเครื่องแล้ว · จะอัปขึ้น Firebase ทีหลัง",
        );
      }
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
      const result = await savePosShopSettings({
        promptPayId: normalized,
        autoPrintReceipt,
      });
      setPromptPayId(normalized);
      setSavedMsg(
        result.synced
          ? normalized
            ? "PromptPay พร้อมใช้ · อัป Firebase แล้ว"
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

  async function saveMenu(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await savePosShopSettings({
        menuArrangeMode,
        bestsellerWindowDays,
      });
      setSavedMsg(
        result.synced
          ? menuArrangeMode === "bestsellers"
            ? "ใช้กลุ่มขายดีแล้ว · อัป Firebase แล้ว — หน้า POS จะเรียงตอนรีเฟรชเมนู"
            : "ใช้ลำดับคงที่แล้ว · อัป Firebase แล้ว"
          : "บันทึกในเครื่องแล้ว · จะอัป Firebase ทีหลัง",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`pos-module pos-biz-module${embedded ? " pos-biz-module--embedded" : ""}`}>
      <div className="pos-module-subnav pos-biz-subnav">
        <button type="button" className={tab === "bill" ? "is-active" : ""} onClick={() => setTab("bill")}>
          บนบิล
        </button>
        <button type="button" className={tab === "pay" ? "is-active" : ""} onClick={() => setTab("pay")}>
          ชำระเงิน
        </button>
        <button type="button" className={tab === "menu" ? "is-active" : ""} onClick={() => setTab("menu")}>
          จัดเมนู
        </button>
        <span className="pos-biz-version muted">{posVersionLabel()}</span>
      </div>

      <div className="pos-module-content pos-biz-content">
        {localError ? <p className="error-text">{localError}</p> : null}
        {savedMsg ? <p className="ok-text pos-biz-saved">{savedMsg}</p> : null}

        {tab === "bill" ? (
          <div className="pos-biz-layout pos-biz-layout--preview-first">
            <DocPreview shop={draftPreview} />
            <form className="pos-biz-form" onSubmit={(e) => void saveBill(e)}>
              <p className="muted pos-biz-lead">
                หัวบิล · <strong>กดบันทึก</strong> ถึงขึ้น Firebase
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
              <button type="submit" className="primary-btn pos-biz-save" disabled={busy}>
                {busy ? "กำลังบันทึก..." : "บันทึกขึ้น Firebase"}
              </button>
            </form>
          </div>
        ) : tab === "pay" ? (
          <form className="pos-biz-form pos-biz-form--pay" onSubmit={(e) => void savePay(e)}>
            <p className="muted pos-biz-lead">
              PromptPay พร้อมใช้แบบสแกน QR + พนักงานกดยืนยันเมื่อได้เงิน
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
                <span>พิมพ์ใบเสร็จอัตโนมัติหลังขาย</span>
              </label>
            </div>
            <button type="submit" className="pos-btn-orange pos-biz-save" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึกชำระเงิน"}
            </button>
          </form>
        ) : (
          <form className="pos-biz-form pos-biz-form--menu" onSubmit={(e) => void saveMenu(e)}>
            <p className="muted pos-biz-lead">
              เลือกรูปการจัดเรียงหน้า POS · กลุ่มขายดีใช้ยอดจริงจากบิล (ไม่ใช่ธงแนะนำ) · เลื่อนตำแหน่งตอนรีเฟรชเมนู/เปิดกะ
              ไม่เลื่อนกลางบิล
            </p>
            <fieldset className="pos-biz-arrange">
              <legend>รูปการจัดเรียง</legend>
              <label className="pos-biz-check">
                <input
                  type="radio"
                  name="menuArrangeMode"
                  checked={menuArrangeMode === "fix"}
                  onChange={() => setMenuArrangeMode("fix")}
                />
                <span>
                  <strong>แบบ fix</strong> — ลำดับคงที่ / ลากมือตามเดิม
                </span>
              </label>
              <label className="pos-biz-check">
                <input
                  type="radio"
                  name="menuArrangeMode"
                  checked={menuArrangeMode === "bestsellers"}
                  onChange={() => setMenuArrangeMode("bestsellers")}
                />
                <span>
                  <strong>แบบกลุ่มขายดี</strong> — หมวดขายดีขึ้นหน้า · เมนูขายดีขึ้นบน (อัตโนมัติ)
                </span>
              </label>
            </fieldset>
            <label>
              <span>หน้าต่างสถิติ (วัน)</span>
              <select
                value={bestsellerWindowDays}
                onChange={(e) => setBestsellerWindowDays(Number(e.target.value) || 7)}
              >
                <option value={7}>7 วัน (ช่วงแรก)</option>
                <option value={14}>14 วัน</option>
              </select>
            </label>
            <button type="submit" className="pos-btn-orange pos-biz-save" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึกการจัดเมนู"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
