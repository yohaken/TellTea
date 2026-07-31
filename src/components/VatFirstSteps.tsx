"use client";

import { VatClaimModeToggle } from "@/components/EntryVatFieldset";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { parseVatInputStr } from "@/lib/entry-vat";
import { evidenceNoticeCopy } from "@/lib/ledger-evidence-policy";
import type { VatFirstPhase } from "@/lib/ledger-vat-first";
import { formatVatMoney } from "@/lib/vat-number-format";

type ExtractStatus = "idle" | "loading" | "ready" | "error";

/**
 * Shared ask → upload/AI confirm or manual panels for VAT-first create flows.
 * Parent owns phase + extract; this only renders the gate UI.
 */
export function VatFirstAskPanel({
  onChooseHasVat,
  onClose,
}: {
  onChooseHasVat: (yes: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="vat-first-panel" role="group" aria-label="ถาม VAT ก่อนบันทึก">
      <p className="vat-first-title">เอกสารนี้มี VAT หรือไม่?</p>
      <p className="muted vat-first-hint">
        หมายถึงยอดภาษีมูลค่าเพิ่มบนใบกำกับ/ใบเสร็จ — ไม่ใช่ยอดจ่ายรวม
      </p>
      <div className="vat-first-actions">
        <button type="button" className="primary-btn" onClick={() => onChooseHasVat(true)}>
          มี VAT
        </button>
        <button type="button" className="ghost-btn" onClick={() => onChooseHasVat(false)}>
          ไม่มี VAT
        </button>
      </div>
      <button type="button" className="ghost-btn vat-first-cancel" onClick={onClose}>
        ออก
      </button>
    </div>
  );
}

export function VatFirstCapturePanel({
  phase,
  receiptUrls,
  onReceiptUrlsChange,
  onError,
  maxPhotos,
  storageFolder,
  storageSlotKey,
  extractStatus,
  aiVatReason,
  pendingAiVat,
  vatInputStr,
  onVatInputStrChange,
  onConfirmAi,
  onRejectAi,
  onConfirmManual,
  onResetAsk,
  onRereadAi,
  onClose,
  manualInputId = "vat-first-manual",
}: {
  phase: Extract<VatFirstPhase, "upload" | "confirm_ai" | "manual">;
  receiptUrls: string[];
  onReceiptUrlsChange: (next: string[]) => void;
  onError: (msg: string) => void;
  maxPhotos: number;
  storageFolder: string;
  storageSlotKey: string;
  extractStatus: ExtractStatus;
  aiVatReason: string;
  pendingAiVat: number | null;
  vatInputStr: string;
  onVatInputStrChange: (value: string) => void;
  onConfirmAi: () => void;
  onRejectAi: () => void;
  onConfirmManual: () => void;
  onResetAsk: () => void;
  onRereadAi: () => void;
  onClose: () => void;
  manualInputId?: string;
}) {
  const vatInputNum = parseVatInputStr(vatInputStr);

  return (
    <div className="vat-first-panel">
      <p className="vat-first-title">ขั้นที่ 1 · ยอดภาษีมูลค่าเพิ่ม</p>
      <p className="muted vat-first-hint">
        แนบบิลให้ครบ (สลิป + ใบกำกับ) — ระบบอ่านยอดภาษีก่อน แล้วค่อยกรอกรายการ
      </p>
      <PhotoAttachMultiField
        label="รูปใบเสร็จ / ใบกำกับ"
        values={receiptUrls}
        onChange={onReceiptUrlsChange}
        onError={onError}
        max={maxPhotos}
        storageFolder={storageFolder}
        storageSlotKey={storageSlotKey}
        hint="ถ่าย/แนบ — AI อ่านยอดภาษีมูลค่าเพิ่มก่อน"
      />
      {extractStatus === "loading" ? (
        <p className="muted vat-first-status" aria-live="polite">
          กำลังอ่านยอดภาษีจากรูป…
        </p>
      ) : null}
      {aiVatReason && extractStatus !== "loading" ? (
        <p className="muted vat-first-status">{aiVatReason}</p>
      ) : null}

      {phase === "confirm_ai" && pendingAiVat != null ? (
        <div className="vat-first-confirm" role="group" aria-label="ยืนยันยอด VAT จาก AI">
          <p className="vat-first-confirm-label">ยอดภาษีมูลค่าเพิ่มจากเอกสาร</p>
          <p className="vat-first-confirm-amount">{formatVatMoney(pendingAiVat)}</p>
          <p className="muted vat-first-hint">ตัวเลขนี้ตรงกับเอกสารหรือไม่?</p>
          <div className="vat-first-actions">
            <button type="button" className="primary-btn" onClick={onConfirmAi}>
              ตรงกับเอกสาร
            </button>
            <button type="button" className="ghost-btn" onClick={onRejectAi}>
              ไม่ตรง · กรอกเอง
            </button>
          </div>
        </div>
      ) : null}

      {phase === "manual" ? (
        <div className="vat-first-manual" role="group" aria-label="กรอกยอด VAT เอง">
          <div className="field">
            <label htmlFor={manualInputId}>ยอดภาษีมูลค่าเพิ่ม (บาท)</label>
            <input
              id={manualInputId}
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={vatInputStr}
              onChange={(e) => onVatInputStrChange(e.target.value)}
              placeholder="ตามบิล"
              autoFocus
            />
          </div>
          <div className="vat-first-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={vatInputNum <= 0}
              onClick={onConfirmManual}
            >
              ยืนยันยอดนี้
            </button>
            {receiptUrls.length ? (
              <button
                type="button"
                className="ghost-btn"
                disabled={extractStatus === "loading"}
                onClick={onRereadAi}
              >
                ให้ AI อ่านอีกครั้ง
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="vat-first-footer-links">
        <button type="button" className="linkish-btn" onClick={onResetAsk}>
          ← เปลี่ยนเป็นไม่มี VAT
        </button>
        <button type="button" className="ghost-btn" onClick={onClose}>
          ออก
        </button>
      </div>
    </div>
  );
}

export function VatFirstFormSummary({
  hasVat,
  vatInput,
  vatSource,
  onEditVat,
  vatClaim = false,
  onVatClaimChange,
  disabled,
  amountInclusive = 0,
}: {
  hasVat: boolean;
  vatInput: number;
  vatSource: string;
  onEditVat: () => void;
  vatClaim?: boolean;
  onVatClaimChange?: (claim: boolean) => void;
  disabled?: boolean;
  amountInclusive?: number;
}) {
  if (!hasVat) {
    return <p className="muted vat-first-summary-no">ไม่มี VAT · กรอกรายการได้เลย</p>;
  }
  return (
    <div className="vat-first-summary-block" aria-live="polite">
      <div className="vat-first-summary">
        <span>
          VAT ยืนยันแล้ว · {formatVatMoney(vatInput)} บาท
          {vatSource === "ai" ? " · จาก AI" : " · กรอกเอง"}
        </span>
        <button type="button" className="linkish-btn" onClick={onEditVat}>
          แก้ยอด VAT
        </button>
      </div>
      {vatInput > 0 && onVatClaimChange ? (
        <VatClaimModeToggle
          vatClaim={vatClaim}
          disabled={disabled}
          onChange={onVatClaimChange}
          amountInclusive={amountInclusive}
          vatInput={vatInput}
        />
      ) : null}
    </div>
  );
}

/**
 * Serious evidence notice + one ack (shared staff ledger / owner books / bill notice).
 * Not a VAT-style multi-step gate — one checkbox so the rule is always seen.
 */
export function EvidenceDocNotice({
  description,
  acked,
  onAckChange,
  slipOnly = false,
  vatReason = "",
  docKind = "",
  disabled,
  idPrefix = "evidence-doc",
}: {
  description: string;
  acked: boolean;
  onAckChange: (acked: boolean) => void;
  slipOnly?: boolean;
  vatReason?: string;
  docKind?: string;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const copy = evidenceNoticeCopy({
    description,
    slipOnly,
    vatReason,
    docKind,
  });
  const checkboxId = `${idPrefix}-ack`;

  return (
    <div
      className={
        copy.escalate
          ? "evidence-doc-notice evidence-doc-notice--escalate"
          : "evidence-doc-notice"
      }
      role="group"
      aria-label="หลักฐานเอกสารรายการจ่าย"
      data-policy={copy.policy}
    >
      <p className="evidence-doc-title">{copy.title}</p>
      <p className="evidence-doc-body">{copy.body}</p>
      <label className="evidence-doc-ack" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={acked}
          disabled={disabled}
          onChange={(e) => onAckChange(e.target.checked)}
        />
        <span>{copy.ackLabel}</span>
      </label>
    </div>
  );
}
