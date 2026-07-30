"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { EntryVatFieldset } from "@/components/EntryVatFieldset";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import {
  normalizeVatSource,
  parseVatInputStr,
  type VatSource,
} from "@/lib/entry-vat";
import {
  getLedgerEntry,
  getLedgerReceiptUrls,
  LEDGER_RECEIPT_MAX,
  updateLedgerEntry,
} from "@/lib/ledger";
import {
  EXTRACT_RECEIPT_MAX,
  extractOwnerBookFromReceipt,
} from "@/lib/owner-books-ai";
import {
  getOwnerBookEntry,
  getOwnerBookReceiptUrls,
  OWNER_BOOKS_RECEIPT_MAX,
  updateOwnerBookEntry,
  type OwnerBookEntry,
} from "@/lib/owner-books";
import type { BooksVatBook } from "@/lib/books-vat-month";
import { bookLabel } from "@/lib/books-vat-month";
import type { LedgerEntry } from "@/lib/types";
import { parseDateInput, todayInputValue } from "@/lib/utils";

function toDateInput(ms: number) {
  return todayInputValue(new Date(ms));
}

type Props = {
  book: BooksVatBook;
  entryId: string;
  locked?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * มุมมองรายการแบบบช. — เปิดจากตาราง VAT เดือน (+)
 * ดูรูป / ยอด / VAT / ติ๊ก「รวมเข้างบ」ได้ทันที
 */
export function BooksVatEntryDetailModal({
  book,
  entryId,
  locked = false,
  onClose,
  onSaved,
}: Props) {
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState<LedgerEntry | OwnerBookEntry | null>(null);

  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [hasVat, setHasVat] = useState(false);
  const [vatInputStr, setVatInputStr] = useState("");
  const [vatInvoiceNo, setVatInvoiceNo] = useState("");
  const [vatSource, setVatSource] = useState<VatSource>("");
  const [vatVerified, setVatVerified] = useState(false);
  const [vatClaim, setVatClaim] = useState(false);
  const [aiVatReason, setAiVatReason] = useState("");
  const [extractStatus, setExtractStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const lastExtractKeyRef = useRef("");
  const extractBusyRef = useRef(false);
  const descriptionRef = useRef("");
  const amountRef = useRef("");

  descriptionRef.current = description;
  amountRef.current = amount;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    (async () => {
      try {
        const row =
          book === "ledger"
            ? await getLedgerEntry(entryId)
            : await getOwnerBookEntry(entryId);
        if (cancelled) return;
        if (!row) {
          setLoadError("ไม่พบรายการ");
          setEntry(null);
          return;
        }
        setEntry(row);
        setDate(toDateInput(row.date));
        setDescription(row.description || "");
        setAmount(String(row.amountOut || ""));
        setNote(
          book === "owner" && "note" in row
            ? String((row as OwnerBookEntry).note || "")
            : "",
        );
        setReceiptUrls(
          book === "ledger"
            ? getLedgerReceiptUrls(row)
            : getOwnerBookReceiptUrls(row),
        );
        setHasVat(Boolean(row.hasVat));
        setVatInputStr(
          row.hasVat && (row.vatInput || 0) > 0 ? String(row.vatInput) : "",
        );
        setVatInvoiceNo(row.vatInvoiceNo || "");
        setVatSource(normalizeVatSource(row.vatSource));
        setVatVerified(Boolean(row.vatVerified));
        setVatClaim(Boolean(row.vatClaim));
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book, entryId]);

  async function runExtractFromPhotos(urls: string[]) {
    const refs = urls
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, EXTRACT_RECEIPT_MAX);
    if (!refs.length || locked) return;
    const key = refs.join("|");
    if (key === lastExtractKeyRef.current || extractBusyRef.current) return;
    extractBusyRef.current = true;
    setExtractStatus("loading");
    try {
      const result = await extractOwnerBookFromReceipt(refs);
      lastExtractKeyRef.current = key;
      // Keep accounting date — AI must not overwrite.
      if (result.description && !descriptionRef.current.trim()) {
        setDescription(result.description);
      }
      if (result.amountOut != null && !amountRef.current.trim()) {
        setAmount(String(result.amountOut));
      }
      setAiVatReason(result.vatReason || result.reason || "");
      if (result.hasVat && result.vatInput != null && result.vatInput > 0) {
        setHasVat(true);
        setVatInputStr(String(result.vatInput));
        if (result.vatInvoiceNo) setVatInvoiceNo(result.vatInvoiceNo);
        setVatSource("ai");
        setVatVerified(false);
        // ไม่ auto รวมเข้างบ — ให้คนติ๊กเอง
      } else {
        setAiVatReason(
          result.vatReason ||
            "AI ไม่เห็นบรรทัดภาษีบนบิล — กรอกเองหรือไม่ติ๊ก VAT",
        );
      }
      setExtractStatus("ready");
    } catch {
      setExtractStatus("error");
      setAiVatReason("อ่านจากรูปไม่สำเร็จ — กรอก VAT เองได้");
    } finally {
      extractBusyRef.current = false;
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (locked || !entry) return;
    setBusy(true);
    setFormError("");
    try {
      const amountOut = Number(amount);
      if (!(amountOut > 0)) throw new Error("ต้องใส่จำนวนเงินออก");
      if (!description.trim()) throw new Error("ต้องใส่รายการ");
      const vatInputNum = parseVatInputStr(vatInputStr);
      if (hasVat && vatInputNum <= 0) {
        throw new Error("มี VAT — ใส่ยอดภาษีซื้อจากบิล หรือกดใช้ประมาณ ×7/107");
      }
      const vatPayload = {
        hasVat,
        vatInput: hasVat ? vatInputNum : 0,
        vatInvoiceNo: hasVat ? vatInvoiceNo.trim() : "",
        vatSource: hasVat ? vatSource || "manual" : "",
        vatVerified: hasVat ? vatVerified : false,
        vatClaim: hasVat && vatInputNum > 0 ? vatClaim : false,
      };
      if (book === "ledger") {
        await updateLedgerEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountIn: 0,
          amountOut,
          receiptUrls,
          ...vatPayload,
        });
      } else {
        await updateOwnerBookEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountOut,
          receiptUrls,
          note,
          ...vatPayload,
        });
      }
      onSaved();
    } catch (err) {
      setFormError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const maxPhotos = book === "ledger" ? LEDGER_RECEIPT_MAX : OWNER_BOOKS_RECEIPT_MAX;
  const storageFolder =
    book === "ledger" ? "ledger-receipts" : "owner-books";

  return (
    <div className="modal-backdrop edit-modal is-module-form" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`รายการบช.${bookLabel(book)}`}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">
            บช.{bookLabel(book)} · ดู/แก้ VAT
          </h2>
          <div className="entry-toolbar-actions">
            <button
              type="button"
              className="ghost-btn icon-btn"
              aria-label="ปิด"
              disabled={busy}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted form-hint-inline">กำลังโหลด…</p>
        ) : loadError ? (
          <p className="error-text ot-form-error">{loadError}</p>
        ) : entry ? (
          <>
            <EntryTimestampsMeta
              entryDate={entry.date}
              createdAt={entry.createdAt}
              updatedAt={entry.updatedAt}
            />
            {formError ? (
              <p className="error-text ot-form-error">{formError}</p>
            ) : null}
            <form
              className="form-card entry-form"
              onSubmit={(e) => void onSave(e)}
            >
              <PhotoAttachMultiField
                label="รูปใบเสร็จ"
                values={receiptUrls}
                onChange={(next) => {
                  const prev = receiptUrls;
                  setReceiptUrls(next);
                  const added = next.some((u) => !prev.includes(u));
                  if (added && !locked) void runExtractFromPhotos(next);
                }}
                onError={(msg) => setFormError(msg)}
                max={maxPhotos}
                storageFolder={storageFolder}
                storageSlotKey={entry.id}
                readOnly={locked}
              />

              <div className="field">
                <label htmlFor="vat-detail-date">วันที่</label>
                <input
                  id="vat-detail-date"
                  type="date"
                  value={date}
                  disabled={busy || locked}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="vat-detail-desc">รายการ</label>
                <input
                  id="vat-detail-desc"
                  value={description}
                  disabled={busy || locked}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="vat-detail-amount">เงินออก</label>
                <input
                  id="vat-detail-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  disabled={busy || locked}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              {book === "owner" ? (
                <div className="field">
                  <label htmlFor="vat-detail-note">หมายเหตุ</label>
                  <input
                    id="vat-detail-note"
                    value={note}
                    disabled={busy || locked}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              ) : null}

              <EntryVatFieldset
                idPrefix="vat-detail"
                disabled={busy || locked}
                amountInclusive={Number(amount) || 0}
                hasVat={hasVat}
                vatInputStr={vatInputStr}
                vatInvoiceNo={vatInvoiceNo}
                vatSource={vatSource}
                vatVerified={vatVerified}
                aiStatus={
                  receiptUrls.length === 0
                    ? "none"
                    : extractStatus === "loading"
                      ? "loading"
                      : extractStatus === "error"
                        ? "error"
                        : extractStatus === "ready"
                          ? "ready"
                          : "idle"
                }
                aiVatReason={aiVatReason}
                onHasVatChange={setHasVat}
                onVatInputChange={setVatInputStr}
                onVatInvoiceNoChange={setVatInvoiceNo}
                onVatSourceChange={setVatSource}
                onVatVerifiedChange={setVatVerified}
                onVendorHint={(name) => {
                  if (!description.trim()) setDescription(name);
                }}
                canRereadAi={receiptUrls.length > 0 && !locked}
                onRereadAi={() => {
                  lastExtractKeyRef.current = "";
                  void runExtractFromPhotos(receiptUrls);
                }}
              />

              {hasVat && parseVatInputStr(vatInputStr) > 0 ? (
                <label className="owner-vat-toggle vat-claim-toggle">
                  <input
                    type="checkbox"
                    checked={vatClaim}
                    disabled={busy || locked}
                    onChange={(e) => setVatClaim(e.target.checked)}
                  />
                  รวมเข้างบ · หักภาษีซื้อ VAT เดือนนี้
                </label>
              ) : null}

              <div className="entry-actions module-form-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={onClose}
                >
                  ปิด
                </button>
                {!locked ? (
                  <button type="submit" className="primary-btn" disabled={busy}>
                    {busy ? "กำลังบันทึก…" : "บันทึก"}
                  </button>
                ) : null}
              </div>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
