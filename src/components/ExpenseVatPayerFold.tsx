"use client";

import type { ExpenseVatPayerFields } from "@/lib/expense-vat";
import {
  buildExpenseVatPayerPayload,
  canSyncVatInputInvoice,
  expenseVatFoldSummary,
  expenseVatFromGross,
  labelExpenseInvoiceNameOk,
  labelExpensePayer,
  labelExpenseVatMode,
  type ExpenseInvoiceNameOk,
  type ExpensePayer,
  type ExpenseVatMode,
} from "@/lib/expense-vat";
import { formatPlainNumber } from "@/lib/utils";

type Props = {
  value: ExpenseVatPayerFields;
  amountOut: number;
  onChange: (next: ExpenseVatPayerFields) => void;
  disabled?: boolean;
  /** id prefix for labels */
  idPrefix?: string;
};

/**
 * กล่อง VAT / ผู้จ่าย — แสดงแบบหุบเท่านั้น (ไม่บังคับเปิด)
 * เปิดเมื่อพนักงานต้องการแจกแจงภาษีซื้อหรือชื่อบนเอกสาร
 */
export function ExpenseVatPayerFold({
  value,
  amountOut,
  onChange,
  disabled = false,
  idPrefix = "exp-vat",
}: Props) {
  const summary = expenseVatFoldSummary(value);
  const syncGate = canSyncVatInputInvoice(value);

  function patch(partial: Partial<ExpenseVatPayerFields>) {
    const merged = { ...value, ...partial };
    if (partial.vatMode === "inclusive" && !(merged.vatInput > 0 || merged.vatBase > 0)) {
      const calc = expenseVatFromGross(amountOut);
      onChange({ ...merged, ...calc });
      return;
    }
    if (partial.vatMode === "none" || partial.vatMode === "unknown") {
      onChange({ ...merged, vatBase: 0, vatInput: 0 });
      return;
    }
    onChange(merged);
  }

  function recalcFromAmount() {
    if (value.vatMode !== "inclusive" || !(amountOut > 0)) return;
    const calc = expenseVatFromGross(amountOut);
    onChange({ ...value, ...calc });
  }

  return (
    <details className="expense-vat-fold">
      <summary className="expense-vat-fold-summary">
        <span className="expense-vat-fold-title">VAT / ผู้จ่าย</span>
        <span className="expense-vat-fold-hint muted" title={summary}>
          {summary}
        </span>
      </summary>
      <div className="expense-vat-fold-body">
        <p className="muted expense-vat-fold-help">
          แยกภาษีซื้อไว้ขอคืน · เช็คว่าใบกำกับออกในนามใคร — ว่างไว้ได้
        </p>

        <div className="field">
          <label htmlFor={`${idPrefix}-mode`}>มี VAT ในบิลไหม</label>
          <select
            id={`${idPrefix}-mode`}
            value={value.vatMode}
            disabled={disabled}
            onChange={(e) => patch({ vatMode: e.target.value as ExpenseVatMode })}
          >
            <option value="unknown">{labelExpenseVatMode("unknown")}</option>
            <option value="none">{labelExpenseVatMode("none")}</option>
            <option value="inclusive">{labelExpenseVatMode("inclusive")}</option>
          </select>
        </div>

        {value.vatMode === "inclusive" ? (
          <div className="expense-vat-fold-vat-row">
            <div className="field">
              <label htmlFor={`${idPrefix}-base`}>ฐานภาษี</label>
              <input
                id={`${idPrefix}-base`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                disabled={disabled}
                value={value.vatBase ? String(value.vatBase) : ""}
                placeholder="0"
                onChange={(e) =>
                  patch({ vatBase: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-vat`}>VAT ซื้อ</label>
              <input
                id={`${idPrefix}-vat`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                disabled={disabled}
                value={value.vatInput ? String(value.vatInput) : ""}
                placeholder="0"
                onChange={(e) =>
                  patch({ vatInput: Number(e.target.value) || 0 })
                }
              />
            </div>
            <button
              type="button"
              className="ghost-btn expense-vat-recalc"
              disabled={disabled || !(amountOut > 0)}
              title="คิดจากยอดรวม 7/107"
              onClick={recalcFromAmount}
            >
              คิด 7%
            </button>
          </div>
        ) : null}

        {value.vatMode === "inclusive" && amountOut > 0 ? (
          <p className="muted expense-vat-fold-help">
            ยอดจ่าย {formatPlainNumber(amountOut)}
            {value.vatInput > 0
              ? ` · VAT ${formatPlainNumber(value.vatInput)}`
              : " · กดคิด 7% หรือใส่เอง"}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor={`${idPrefix}-inv`}>เลขที่ใบกำกับ</label>
          <input
            id={`${idPrefix}-inv`}
            value={value.taxInvoiceNo}
            disabled={disabled}
            maxLength={80}
            placeholder="ว่างได้"
            autoComplete="off"
            onChange={(e) => patch({ taxInvoiceNo: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-vendor`}>ผู้ขาย / ร้าน</label>
          <input
            id={`${idPrefix}-vendor`}
            value={value.vendor}
            disabled={disabled}
            maxLength={120}
            placeholder="ชื่อบนใบกำกับฝั่งผู้ขาย"
            autoComplete="off"
            onChange={(e) => patch({ vendor: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-payer`}>ผู้จ่าย</label>
          <select
            id={`${idPrefix}-payer`}
            value={value.payer}
            disabled={disabled}
            onChange={(e) => patch({ payer: e.target.value as ExpensePayer })}
          >
            <option value="">{labelExpensePayer("")}</option>
            <option value="shop">{labelExpensePayer("shop")}</option>
            <option value="owner">{labelExpensePayer("owner")}</option>
            <option value="staff">{labelExpensePayer("staff")}</option>
            <option value="other">{labelExpensePayer("other")}</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-name`}>ใบกำกับในนาม</label>
          <input
            id={`${idPrefix}-name`}
            value={value.invoiceName}
            disabled={disabled}
            maxLength={120}
            placeholder="ชื่อบนเอกสาร"
            autoComplete="off"
            onChange={(e) => patch({ invoiceName: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-ok`}>เอกสารใช้ขอคืนได้ไหม</label>
          <select
            id={`${idPrefix}-ok`}
            value={value.invoiceNameOk}
            disabled={disabled}
            onChange={(e) =>
              patch({ invoiceNameOk: e.target.value as ExpenseInvoiceNameOk })
            }
          >
            <option value="unknown">{labelExpenseInvoiceNameOk("unknown")}</option>
            <option value="ok">{labelExpenseInvoiceNameOk("ok")}</option>
            <option value="mismatch">{labelExpenseInvoiceNameOk("mismatch")}</option>
            <option value="no_invoice">
              {labelExpenseInvoiceNameOk("no_invoice")}
            </option>
          </select>
        </div>

        {value.vatInputInvoiceId ? (
          <p className="muted expense-vat-fold-help">
            ลิงก์ภาษีซื้อแล้ว · ถ้าเปลี่ยนเป็นไม่ขอคืน ระบบจะถอนลิงก์ตอนบันทึก
          </p>
        ) : value.vatMode === "inclusive" ? (
          <p className="muted expense-vat-fold-help">
            {syncGate.ok
              ? "พร้อมลิงก์ภาษีซื้อเมื่อเจ้าของบันทึก/รับบิล"
              : syncGate.reason}
          </p>
        ) : null}
      </div>
    </details>
  );
}

/** Helper for callers that build save payload */
export function prepareExpenseVatForSave(
  value: ExpenseVatPayerFields,
  amountOut: number,
): ExpenseVatPayerFields {
  return buildExpenseVatPayerPayload(value, amountOut);
}
