"use client";

import { COMMON_VAT_VENDORS, proposePurchaseVatInput } from "@/lib/entry-vat";
import { formatVatMoney } from "@/lib/vat-number-format";

type Props = {
  idPrefix: string;
  disabled?: boolean;
  amountInclusive: number;
  hasVat: boolean;
  vatInputStr: string;
  vatInvoiceNo: string;
  onHasVatChange: (on: boolean) => void;
  onVatInputChange: (v: string) => void;
  onVatInvoiceNoChange: (v: string) => void;
  /** ถ้ามี — แตะชื่อร้านเติมในรายการ */
  onVendorHint?: (name: string) => void;
  hint?: string;
};

/** ช่อง VAT ภาษีซื้อ — ใช้บช.พนักงาน / บช.เจ้าของ */
export function EntryVatFieldset({
  idPrefix,
  disabled,
  amountInclusive,
  hasVat,
  vatInputStr,
  vatInvoiceNo,
  onHasVatChange,
  onVatInputChange,
  onVatInvoiceNoChange,
  onVendorHint,
  hint = "ติ๊กเมื่อบิลมี VAT เช่น แม็คโคร · ท็อปส์ · ท็อปแวลู — รวมเข้า VAT เดือนได้",
}: Props) {
  const proposed = proposePurchaseVatInput(amountInclusive || 0);

  return (
    <fieldset className="entry-vat-box owner-vat-box">
      <legend>ช่อง VAT · ภาษีซื้อ</legend>
      <label className="owner-vat-toggle">
        <input
          type="checkbox"
          checked={hasVat}
          disabled={disabled}
          onChange={(e) => {
            const on = e.target.checked;
            onHasVatChange(on);
            if (on && (!vatInputStr.trim() || Number(vatInputStr) <= 0) && amountInclusive > 0) {
              onVatInputChange(String(proposed));
            }
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
              <span className="muted">
                {" "}
                · เสนอ {formatVatMoney(proposed)} จากยอด×7/107
              </span>
            </label>
            <input
              id={`${idPrefix}-vat-input`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={vatInputStr}
              disabled={disabled}
              placeholder={proposed > 0 ? String(proposed) : ""}
              onChange={(e) => onVatInputChange(e.target.value)}
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
              onChange={(e) => onVatInvoiceNoChange(e.target.value)}
            />
          </div>
        </>
      ) : (
        <p className="muted form-hint-inline">{hint}</p>
      )}
    </fieldset>
  );
}
