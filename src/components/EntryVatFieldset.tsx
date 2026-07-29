"use client";

import {
  COMMON_VAT_VENDORS,
  proposePurchaseVatInput,
  type VatSource,
} from "@/lib/entry-vat";
import { formatVatMoney } from "@/lib/vat-number-format";

type Props = {
  idPrefix: string;
  disabled?: boolean;
  amountInclusive: number;
  hasVat: boolean;
  vatInputStr: string;
  vatInvoiceNo: string;
  vatSource: VatSource;
  vatVerified: boolean;
  /** สถานะอ่าน AI */
  aiStatus?: "idle" | "loading" | "ready" | "error" | "none";
  aiVatReason?: string;
  onHasVatChange: (on: boolean) => void;
  onVatInputChange: (v: string) => void;
  onVatInvoiceNoChange: (v: string) => void;
  onVatSourceChange: (s: VatSource) => void;
  onVatVerifiedChange: (v: boolean) => void;
  onVendorHint?: (name: string) => void;
  /** ขอให้อ่าน AI อีกครั้ง (มีรูป) */
  onRereadAi?: () => void;
  canRereadAi?: boolean;
};

/**
 * ช่อง VAT — AI อ่านก่อน · ติ๊กตรวจตรงบิล · กรอกเอง / ประมาณเป็นทางเลือก
 */
export function EntryVatFieldset({
  idPrefix,
  disabled,
  amountInclusive,
  hasVat,
  vatInputStr,
  vatInvoiceNo,
  vatSource,
  vatVerified,
  aiStatus = "idle",
  aiVatReason = "",
  onHasVatChange,
  onVatInputChange,
  onVatInvoiceNoChange,
  onVatSourceChange,
  onVatVerifiedChange,
  onVendorHint,
  onRereadAi,
  canRereadAi,
}: Props) {
  const proposed = proposePurchaseVatInput(amountInclusive || 0);
  const vatNum = Number(String(vatInputStr).replace(/,/g, ""));
  const hasVatAmount = Number.isFinite(vatNum) && vatNum > 0;

  function sourceLabel() {
    if (vatSource === "ai") return "จาก AI อ่านบิล";
    if (vatSource === "propose") return "ประมาณ ×7/107 (ไม่ใช่จากบิล)";
    if (vatSource === "manual") return "กรอกเอง";
    return "";
  }

  return (
    <fieldset className="entry-vat-box owner-vat-box">
      <legend>ช่อง VAT · ภาษีซื้อ</legend>
      <p className="muted form-hint-inline" style={{ marginTop: 0 }}>
        หลัก: แนบรูป → AI อ่านบรรทัดภาษีบนบิลก่อน · อย่าใช้ยอดจ่าย×7/107 แทนบิล
      </p>

      {aiStatus === "loading" ? (
        <p className="muted form-hint-inline">AI กำลังอ่าน VAT จากรูป…</p>
      ) : null}
      {aiStatus === "error" ? (
        <p className="error-text ot-form-error" style={{ fontSize: "0.82rem" }}>
          อ่าน VAT จากรูปไม่สำเร็จ — กรอกเองด้านล่างได้
        </p>
      ) : null}
      {aiStatus === "ready" && aiVatReason ? (
        <p className="muted form-hint-inline">AI: {aiVatReason}</p>
      ) : null}
      {aiStatus === "none" ? (
        <p className="muted form-hint-inline">
          ยังไม่มีรูป — แนบใบเสร็จให้ AI อ่าน หรือติ๊กแล้วกรอกเอง
        </p>
      ) : null}

      {canRereadAi && onRereadAi ? (
        <div className="entry-actions" style={{ marginBottom: "0.4rem" }}>
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled || aiStatus === "loading"}
            onClick={onRereadAi}
          >
            {aiStatus === "loading" ? "กำลังอ่าน…" : "ให้ AI อ่าน VAT จากรูปอีกครั้ง"}
          </button>
        </div>
      ) : null}

      <label className="owner-vat-toggle">
        <input
          type="checkbox"
          checked={hasVat}
          disabled={disabled}
          onChange={(e) => {
            const on = e.target.checked;
            onHasVatChange(on);
            onVatVerifiedChange(false);
            if (!on) {
              onVatSourceChange("");
              return;
            }
            // ไม่ auto ใส่ 7/107 — ให้กรอกเองหรือรอ AI
            if (!vatInputStr.trim()) onVatSourceChange("manual");
          }}
        />
        มีใบกำกับภาษี · หักภาษีซื้อได้
      </label>

      {hasVat ? (
        <>
          {onVendorHint ? (
            <div className="suggest-list" role="listbox" aria-label="ร้านที่พบบ่อย">
              {COMMON_VAT_VENDORS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="suggest-chip"
                  disabled={disabled}
                  onClick={() => onVendorHint(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor={`${idPrefix}-vat-input`}>
              ภาษีซื้อ (บาท)
              {sourceLabel() ? (
                <span className="muted"> · {sourceLabel()}</span>
              ) : null}
            </label>
            <input
              id={`${idPrefix}-vat-input`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={vatInputStr}
              disabled={disabled}
              placeholder="ใส่ตามบิล"
              onChange={(e) => {
                onVatInputChange(e.target.value);
                onVatSourceChange("manual");
                onVatVerifiedChange(false);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor={`${idPrefix}-vat-inv`}>เลขที่ใบกำกับ (ถ้ามี)</label>
            <input
              id={`${idPrefix}-vat-inv`}
              value={vatInvoiceNo}
              disabled={disabled}
              autoComplete="off"
              placeholder="เช่น จากแม็คโคร / ท็อปส์"
              onChange={(e) => {
                onVatInvoiceNoChange(e.target.value);
                if (vatSource === "ai") {
                  /* keep ai source for amount; invoice edit ok */
                } else if (!vatSource) {
                  onVatSourceChange("manual");
                }
                onVatVerifiedChange(false);
              }}
            />
          </div>

          <label className="owner-vat-toggle owner-vat-verify">
            <input
              type="checkbox"
              checked={vatVerified}
              disabled={disabled || !hasVatAmount}
              onChange={(e) => onVatVerifiedChange(e.target.checked)}
            />
            ตรวจแล้ว · ยอดภาษีตรงกับบิล
          </label>
          {hasVatAmount && !vatVerified ? (
            <p className="muted form-hint-inline">
              แนะนำติ๊กยืนยันก่อนบันทึก — โดยเฉพาะเมื่อมาจาก AI หรือประมาณ
            </p>
          ) : null}
          {vatSource === "propose" ? (
            <p className="muted form-hint-inline">
              ค่านี้ประมาณจากยอดจ่าย ไม่ใช่บรรทัดภาษีบนบิล — ตรวจใบเสร็จก่อนติ๊ก
            </p>
          ) : null}

          {proposed > 0 ? (
            <div className="entry-actions" style={{ marginTop: "0.35rem" }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={disabled}
                title="ใช้เมื่อบิลไม่ชัดเท่านั้น"
                onClick={() => {
                  onVatInputChange(String(proposed));
                  onVatSourceChange("propose");
                  onVatVerifiedChange(false);
                  onHasVatChange(true);
                }}
              >
                ใช้ประมาณ {formatVatMoney(proposed)} (×7/107)
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted form-hint-inline">
          ถ้าบิลไม่มี VAT / ใบกำกับย่อ — ไม่ต้องติ๊ก · บันทึกเป็นเงินออกปกติ
        </p>
      )}
    </fieldset>
  );
}
