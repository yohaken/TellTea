"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { AiSaveProgressModal, type AiSaveStage } from "@/components/AiSaveProgressModal";
import { LedgerTypeField } from "@/components/LedgerTypeField";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import {
  classifyLedgerTypeHeuristic,
  classifyLedgerTypeWithAi,
  type LedgerTypeSource,
} from "@/lib/ledger-ai";
import {
  addLedgerEntry,
  frequentDescriptions,
  LEDGER_RECEIPT_MAX,
  listRecentLedgerEntries,
} from "@/lib/ledger";
import { frequentTypes } from "@/lib/ledger-labels";
import {
  parseVatInputStr,
  type VatSource,
} from "@/lib/entry-vat";
import {
  initialVatFirstPhase,
  phaseAfterAiVatExtract,
  phaseAfterVatAsk,
  vatFirstDetailsUnlocked,
  vatFirstReadyToSave,
  type VatFirstPhase,
} from "@/lib/ledger-vat-first";
import {
  EXTRACT_RECEIPT_MAX,
  extractOwnerBookFromReceipt,
} from "@/lib/owner-books-ai";
import { parseDateInput, todayInputValue } from "@/lib/utils";
import { formatVatMoney } from "@/lib/vat-number-format";

/**
 * Create cash-out modal on /ledger/.
 * VAT-first for staff and owner (ask → upload/AI confirm or manual → details).
 */
export function LedgerAddOutModal({
  createdBy,
  isOwner,
  onClose,
  onSaved,
  onError,
}: {
  createdBy: string;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [vatFirstPhase, setVatFirstPhase] = useState<VatFirstPhase>(() =>
    initialVatFirstPhase(isOwner),
  );
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [typeMode, setTypeMode] = useState("auto");
  const [ownerLocked, setOwnerLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveStage, setSaveStage] = useState<AiSaveStage | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [previewType, setPreviewType] = useState("");
  const [previewReason, setPreviewReason] = useState("");
  const [previewSource, setPreviewSource] = useState<LedgerTypeSource>("heuristic");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [hasVat, setHasVat] = useState(false);
  const [vatInputStr, setVatInputStr] = useState("");
  const [vatInvoiceNo, setVatInvoiceNo] = useState("");
  const [vatSource, setVatSource] = useState<VatSource>("");
  const [vatVerified, setVatVerified] = useState(false);
  const [aiVatReason, setAiVatReason] = useState("");
  const [pendingAiVat, setPendingAiVat] = useState<number | null>(null);
  const [extractStatus, setExtractStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const lastExtractKeyRef = useRef("");
  const extractBusyRef = useRef(false);
  const descriptionRef = useRef(description);
  const amountRef = useRef(amount);
  const vatFirstPhaseRef = useRef(vatFirstPhase);
  descriptionRef.current = description;
  amountRef.current = amount;
  vatFirstPhaseRef.current = vatFirstPhase;

  const detailsUnlocked = vatFirstDetailsUnlocked(vatFirstPhase);
  /** VAT-first UI for everyone creating cash-out here (owner testing + staff). */
  const vatFirstGate = true;
  const vatInputNum = parseVatInputStr(vatInputStr);

  const filteredSuggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 6);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [description, suggestions]);

  useEffect(() => {
    void listRecentLedgerEntries(200)
      .then((rows) => {
        setSuggestions(frequentDescriptions(rows));
        setTypeFreq(frequentTypes(rows));
      })
      .catch(() => {
        setSuggestions([]);
        setTypeFreq([]);
      });
  }, []);

  function chooseHasVatDocument(yes: boolean) {
    const next = phaseAfterVatAsk(yes);
    setHasVat(yes);
    setVatVerified(false);
    setVatInputStr("");
    setVatInvoiceNo("");
    setVatSource("");
    setPendingAiVat(null);
    setAiVatReason("");
    setExtractStatus("idle");
    lastExtractKeyRef.current = "";
    setVatFirstPhase(next);
  }

  function confirmAiVatMatches() {
    if (pendingAiVat == null || pendingAiVat <= 0) return;
    setHasVat(true);
    setVatInputStr(String(pendingAiVat));
    setVatSource("ai");
    setVatVerified(true);
    setVatFirstPhase("form");
  }

  function rejectAiVat() {
    setPendingAiVat(null);
    setVatVerified(false);
    setVatInputStr("");
    setVatSource("");
    setVatFirstPhase("manual");
  }

  function confirmManualVat() {
    const n = parseVatInputStr(vatInputStr);
    if (n <= 0) {
      onError("ใส่ยอดภาษีมูลค่าเพิ่ม (บาท) จากเอกสารก่อน");
      return;
    }
    setHasVat(true);
    setVatSource("manual");
    setVatVerified(true);
    setVatFirstPhase("form");
  }

  function resetVatFirstAsk() {
    setVatFirstPhase("ask");
    setHasVat(false);
    setVatVerified(false);
    setVatInputStr("");
    setVatInvoiceNo("");
    setVatSource("");
    setPendingAiVat(null);
    setAiVatReason("");
    setExtractStatus("idle");
    lastExtractKeyRef.current = "";
  }

  async function runExtractFromPhotos(urls: string[]) {
    const refs = urls
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, EXTRACT_RECEIPT_MAX);
    if (!refs.length) return;
    const key = refs.join("|");
    if (key === lastExtractKeyRef.current || extractBusyRef.current) return;
    extractBusyRef.current = true;
    setExtractStatus("loading");
    const inVatFirstUpload =
      vatFirstGate &&
      (vatFirstPhaseRef.current === "upload" ||
        vatFirstPhaseRef.current === "confirm_ai" ||
        vatFirstPhaseRef.current === "manual");
    try {
      const result = await extractOwnerBookFromReceipt(refs);
      lastExtractKeyRef.current = key;
      if (result.description && !descriptionRef.current.trim()) {
        setDescription(result.description);
      }
      if (result.amountOut != null && !amountRef.current.trim()) {
        setAmount(String(result.amountOut));
      }
      if (!ownerLocked && result.type) {
        setTypeMode("auto");
        setPreviewType(result.type);
        setPreviewReason(result.reason || "อ่านจากรูปใบเสร็จ");
        setPreviewSource("ai");
        setPreviewStatus("ready");
      }
      setAiVatReason(result.vatReason || result.reason || "");
      const aiVat =
        result.hasVat && result.vatInput != null && result.vatInput > 0
          ? result.vatInput
          : null;
      if (result.vatInvoiceNo) setVatInvoiceNo(result.vatInvoiceNo);

      if (inVatFirstUpload) {
        setHasVat(true);
        if (aiVat != null) {
          setPendingAiVat(aiVat);
          setVatInputStr(String(aiVat));
          setVatSource("ai");
          setVatVerified(false);
          setVatFirstPhase(phaseAfterAiVatExtract(aiVat));
        } else {
          setPendingAiVat(null);
          setVatInputStr("");
          setVatSource("");
          setVatVerified(false);
          setAiVatReason(
            result.vatReason ||
              "AI ไม่เห็นยอดภาษีมูลค่าเพิ่มบนบิล — กรอกเองจากเอกสาร",
          );
          setVatFirstPhase("manual");
        }
      } else if (aiVat != null) {
        setHasVat(true);
        setVatInputStr(String(aiVat));
        setVatSource("ai");
        setVatVerified(false);
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
      if (inVatFirstUpload) {
        setPendingAiVat(null);
        setVatFirstPhase("manual");
      }
    } finally {
      extractBusyRef.current = false;
    }
  }

  async function runOwnerPreview() {
    const text = description.trim();
    if (!text) {
      onError("ใส่ชื่อรายการก่อนจัดประเภท");
      return;
    }
    setOwnerLocked(false);
    setTypeMode("auto");
    setPreviewStatus("loading");
    setPreviewError(null);
    try {
      const result = await classifyLedgerTypeWithAi(text);
      setPreviewType(result.type);
      setPreviewReason(result.reason);
      setPreviewSource("ai");
      setPreviewStatus("ready");
    } catch (err) {
      const fallback = classifyLedgerTypeHeuristic(text);
      setPreviewType(fallback.type);
      setPreviewReason(fallback.reason);
      setPreviewSource("heuristic");
      setPreviewStatus("error");
      setPreviewError((err as Error).message || "AI ไม่พร้อม");
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      onError("ต้องใส่รายการ");
      return;
    }
    const vatNum = parseVatInputStr(vatInputStr);
    if (
      !vatFirstReadyToSave({
        phase: vatFirstPhase,
        hasVat,
        vatVerified,
        vatInput: vatNum,
      })
    ) {
      onError(
        hasVat
          ? "ยืนยันยอดภาษีมูลค่าเพิ่มให้ตรงเอกสารก่อนบันทึก"
          : "ทำขั้นตอน VAT ให้ครบก่อนบันทึก",
      );
      return;
    }
    setBusy(true);
    setSaveStage("sending");
    try {
      let type = previewType || "cogs";
      let typeSource: LedgerTypeSource = previewSource;
      let typeAiReason = previewReason;

      if (isOwner && ownerLocked && typeMode !== "auto") {
        type = typeMode;
        typeSource = "owner";
        typeAiReason = "";
      } else {
        setSaveStage("sending");
        await new Promise((r) => setTimeout(r, 30));
        setSaveStage("classifying");
        try {
          const result = await classifyLedgerTypeWithAi(description);
          type = result.type;
          typeSource = "ai";
          typeAiReason = result.reason;
        } catch {
          const fallback = classifyLedgerTypeHeuristic(description);
          type = fallback.type;
          typeSource = "heuristic";
          typeAiReason = fallback.reason;
        }
      }

      const amountOut = Number(amount);
      if (hasVat && vatNum <= 0) {
        throw new Error("มี VAT — ใส่ยอดภาษีซื้อจากบิล");
      }
      setSaveStage("saving");
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: 0,
        amountOut,
        type,
        typeSource,
        typeAiReason,
        createdBy,
        receiptUrls,
        hasVat,
        vatInput: hasVat ? vatNum : 0,
        vatInvoiceNo: hasVat ? vatInvoiceNo.trim() : "",
        vatSource: hasVat ? vatSource || "manual" : "",
        vatVerified: hasVat ? vatVerified : false,
        vatClaim: false,
      });
      setSaveStage("done");
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
      setSaveStage(null);
    }
  }

  return (
    <div
      className="modal-backdrop edit-modal is-module-form is-compact-form"
      role="presentation"
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="บันทึกเงินออก">
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">บันทึกเงินออก</h2>
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

        {vatFirstPhase === "ask" ? (
          <div className="vat-first-panel" role="group" aria-label="ถาม VAT ก่อนบันทึก">
            <p className="vat-first-title">เอกสารนี้มี VAT หรือไม่?</p>
            <p className="muted vat-first-hint">
              หมายถึงยอดภาษีมูลค่าเพิ่มบนใบกำกับ/ใบเสร็จ — ไม่ใช่ยอดจ่ายรวม
            </p>
            <div className="vat-first-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => chooseHasVatDocument(true)}
              >
                มี VAT
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => chooseHasVatDocument(false)}
              >
                ไม่มี VAT
              </button>
            </div>
            <button type="button" className="ghost-btn vat-first-cancel" onClick={onClose}>
              ออก
            </button>
          </div>
        ) : null}

        {vatFirstPhase === "upload" ||
        vatFirstPhase === "confirm_ai" ||
        vatFirstPhase === "manual" ? (
          <div className="vat-first-panel">
            <p className="vat-first-title">ขั้นที่ 1 · ยอดภาษีมูลค่าเพิ่ม</p>
            <p className="muted vat-first-hint">
              แนบบิลให้ครบ (สลิป + ใบกำกับ) — ระบบอ่านยอดภาษีก่อน แล้วค่อยกรอกรายการ
            </p>
            <PhotoAttachMultiField
              label="รูปใบเสร็จ / ใบกำกับ"
              values={receiptUrls}
              onChange={(next) => {
                const prev = receiptUrls;
                setReceiptUrls(next);
                const added = next.some((u) => !prev.includes(u));
                if (added) {
                  if (vatFirstPhase === "confirm_ai" || vatFirstPhase === "manual") {
                    setVatFirstPhase("upload");
                    setPendingAiVat(null);
                    setVatVerified(false);
                  }
                  void runExtractFromPhotos(next);
                }
              }}
              onError={onError}
              max={LEDGER_RECEIPT_MAX}
              storageFolder="ledger-receipts"
              storageSlotKey={`add-${createdBy || "new"}`}
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

            {vatFirstPhase === "confirm_ai" && pendingAiVat != null ? (
              <div className="vat-first-confirm" role="group" aria-label="ยืนยันยอด VAT จาก AI">
                <p className="vat-first-confirm-label">ยอดภาษีมูลค่าเพิ่มจากเอกสาร</p>
                <p className="vat-first-confirm-amount">{formatVatMoney(pendingAiVat)}</p>
                <p className="muted vat-first-hint">ตัวเลขนี้ตรงกับเอกสารหรือไม่?</p>
                <div className="vat-first-actions">
                  <button type="button" className="primary-btn" onClick={confirmAiVatMatches}>
                    ตรงกับเอกสาร
                  </button>
                  <button type="button" className="ghost-btn" onClick={rejectAiVat}>
                    ไม่ตรง · กรอกเอง
                  </button>
                </div>
              </div>
            ) : null}

            {vatFirstPhase === "manual" ? (
              <div className="vat-first-manual" role="group" aria-label="กรอกยอด VAT เอง">
                <div className="field">
                  <label htmlFor="add-out-vat-manual">ยอดภาษีมูลค่าเพิ่ม (บาท)</label>
                  <input
                    id="add-out-vat-manual"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={vatInputStr}
                    onChange={(e) => {
                      setVatInputStr(e.target.value);
                      setVatSource("manual");
                      setVatVerified(false);
                    }}
                    placeholder="ตามบิล"
                    autoFocus
                  />
                </div>
                <div className="vat-first-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={vatInputNum <= 0}
                    onClick={confirmManualVat}
                  >
                    ยืนยันยอดนี้
                  </button>
                  {receiptUrls.length ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={extractStatus === "loading"}
                      onClick={() => {
                        lastExtractKeyRef.current = "";
                        setVatFirstPhase("upload");
                        void runExtractFromPhotos(receiptUrls);
                      }}
                    >
                      ให้ AI อ่านอีกครั้ง
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="vat-first-footer-links">
              <button type="button" className="linkish-btn" onClick={resetVatFirstAsk}>
                ← เปลี่ยนเป็นไม่มี VAT
              </button>
              <button type="button" className="ghost-btn" onClick={onClose}>
                ออก
              </button>
            </div>
          </div>
        ) : null}

        {detailsUnlocked ? (
          <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
            {hasVat ? (
              <div className="vat-first-summary" aria-live="polite">
                <span>
                  VAT ยืนยันแล้ว · {formatVatMoney(vatInputNum)} บาท
                  {vatSource === "ai" ? " · จาก AI" : " · กรอกเอง"}
                </span>
                <button
                  type="button"
                  className="linkish-btn"
                  onClick={() => {
                    setVatVerified(false);
                    setVatFirstPhase("manual");
                  }}
                >
                  แก้ยอด VAT
                </button>
              </div>
            ) : (
              <p className="muted vat-first-summary-no">ไม่มี VAT · กรอกรายการได้เลย</p>
            )}

            <div className="field">
              <label htmlFor="add-out-date">วันที่</label>
              <input
                id="add-out-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="add-out-desc">รายการ</label>
              <input
                id="add-out-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="เช่น ค่าน้ำแข็ง / แม็คโคร"
                autoComplete="off"
                required
              />
              {filteredSuggestions.length > 0 ? (
                <div className="suggest-list" role="listbox" aria-label="รายการที่ใช้บ่อย">
                  {filteredSuggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="suggest-chip"
                      onClick={() => setDescription(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="add-out-amount">เงินออก</label>
              <input
                id="add-out-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <PhotoAttachMultiField
              label="รูปใบเสร็จ"
              values={receiptUrls}
              onChange={(next) => {
                const prev = receiptUrls;
                setReceiptUrls(next);
                const added = next.some((u) => !prev.includes(u));
                if (added) void runExtractFromPhotos(next);
              }}
              onError={onError}
              max={LEDGER_RECEIPT_MAX}
              storageFolder="ledger-receipts"
              storageSlotKey={`add-${createdBy || "new"}`}
              hint={
                hasVat
                  ? "เพิ่มรูปได้ · VAT ยืนยันแล้ว"
                  : "ถ่าย/แนบ — AI อ่านรายการ ยอด VAT"
              }
            />
            <LedgerTypeField
              id="add-out-type"
              isOwner={isOwner}
              mode={isOwner ? "live" : "deferred"}
              displayType={isOwner ? previewType : ""}
              aiType={previewType || "cogs"}
              aiReason={previewReason}
              aiSource={previewSource}
              aiStatus={previewStatus}
              aiError={previewError}
              ownerLocked={ownerLocked}
              typeMode={typeMode}
              frequent={typeFreq}
              onTypeModeChange={(value) => {
                setTypeMode(value);
                setOwnerLocked(value !== "auto");
              }}
              onReclassify={() => void runOwnerPreview()}
            />
            <div className="entry-actions">
              <button type="submit" className="primary-btn action-out" disabled={busy}>
                {busy ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
                ออก
              </button>
            </div>
          </form>
        ) : null}
      </div>
      {saveStage ? (
        <AiSaveProgressModal stage={saveStage} detail={description.trim()} />
      ) : null}
    </div>
  );
}
