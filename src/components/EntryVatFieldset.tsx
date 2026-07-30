"use client";

import {
  businessCostOut,
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
 * Compact copy: สถานะสั้น · ปุ่มสั้น · ไม่ซ้ำ intro ยาว
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
  const costExVat = hasVat
    ? businessCostOut(amountInclusive || 0, true, hasVatAmount ? vatNum : 0)
    : 0;

  function sourceLabel() {
    if (vatSource === "ai") return "AI";
    if (vatSource === "propose") return "ประมาณ";
    if (vatSource === "manual") return "กรอกเอง";
    return "";
  }

  return (
    <fieldset className="entry-vat-box owner-vat-box">
      <legend>VAT · ภาษีซื้อ</legend>

      {aiStatus === "loading" ? (
        <p className="muted form-hint-inline">กำลังอ่าน VAT…</p>
      ) : null}
      {aiStatus === "error" ? (
        <p className="error-text ot-form-error" style={{ fontSize: "0.78rem" }}>
          อ่าน VAT ไม่สำเร็จ — กรอกเองได้
        </p>
      ) : null}
      {aiStatus === "ready" && aiVatReason ? (
        <p className="muted form-hint-inline" title={aiVatReason}>
          AI: {aiVatReason}
        </p>
      ) : null}
      {aiStatus === "none" ? (
        <p className="muted form-hint-inline">แนบรูปให้ AI อ่าน หรือติ๊กแล้วกรอกเอง</p>
      ) : null}

      {canRereadAi && onRereadAi ? (
        <div className="entry-actions entry-actions--inline" style={{ marginBottom: "0.35rem" }}>
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled || aiStatus === "loading"}
            onClick={onRereadAi}
            title="ให้ AI อ่าน VAT จากรูปอีกครั้ง"
          >
            {aiStatus === "loading" ? "กำลังอ่าน…" : "อ่าน VAT"}
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
        มีใบกำกับภาษี
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
              placeholder="ตามบิล"
              onChange={(e) => {
                onVatInputChange(e.target.value);
                onVatSourceChange("manual");
                onVatVerifiedChange(false);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor={`${idPrefix}-vat-inv`}>เลขที่ใบกำกับ</label>
            <input
              id={`${idPrefix}-vat-inv`}
              value={vatInvoiceNo}
              disabled={disabled}
              autoComplete="off"
              placeholder="ถ้ามี"
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

          <label
            className="owner-vat-toggle owner-vat-verify"
            title="แนะนำยืนยันก่อนบันทึก โดยเฉพาะเมื่อมาจาก AI หรือประมาณ"
          >
            <input
              type="checkbox"
              checked={vatVerified}
              disabled={disabled || !hasVatAmount}
              onChange={(e) => onVatVerifiedChange(e.target.checked)}
            />
            ตรวจยอดตรงบิลแล้ว
          </label>
          {vatSource === "propose" ? (
            <p className="muted form-hint-inline">
              ประมาณจากยอดจ่าย — ตรวจบิลก่อนติ๊ก
            </p>
          ) : null}

          {hasVatAmount && costExVat > 0 ? (
            <p className="muted form-hint-inline" title="เงินออกยังรวม VAT · รายงานกำไรใช้ต้นทุนหลังหัก">
              ต้นทุนบัญชี ≈ {formatVatMoney(costExVat)} (เงินออก − ภาษีซื้อ)
            </p>
          ) : hasVat ? (
            <p className="muted form-hint-inline">
              ใส่ภาษีซื้อแล้ว · ต้นทุนบัญชี = เงินออก − ภาษีซื้อ
            </p>
          ) : null}

          {proposed > 0 ? (
            <div className="entry-actions entry-actions--inline" style={{ marginTop: "0.3rem" }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={disabled}
                title="ใช้เมื่อบิลไม่ชัดเท่านั้น — ไม่ใช่ยอดภาษีบนบิล"
                onClick={() => {
                  onVatInputChange(String(proposed));
                  onVatSourceChange("propose");
                  onVatVerifiedChange(false);
                  onHasVatChange(true);
                }}
              >
                ประมาณ {formatVatMoney(proposed)}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
