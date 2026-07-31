"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { SheetDateCell } from "@/components/SheetDateCell";
import {
  EvidenceDocNotice,
  VatFirstAskPanel,
  VatFirstCapturePanel,
  VatFirstFormSummary,
} from "@/components/VatFirstSteps";
import {
  acceptBillNotice,
  addBillNotice,
  billNoticeBucketLabel,
  BILL_NOTICE_LIVE_MAX,
  BILL_NOTICE_PAGE_SIZE,
  BILL_NOTICE_PRESETS,
  BILL_NOTICE_RECEIPT_MAX,
  deleteBillNotice,
  getBillNoticeReceiptUrls,
  isBillNoticeReadyForOwnerBooks,
  rejectBillNotice,
  shortLabelBillNoticeStatus,
  subscribeBillNoticesPage,
  summarizeBillNotices,
  updateBillNotice,
  type BillNotice,
  type BillNoticeStatus,
} from "@/lib/bill-notices";
import { parseVatInputStr, type VatSource } from "@/lib/entry-vat";
import {
  evidenceAckRequired,
  evidenceDocPolicy,
  evidenceReadyToSave,
} from "@/lib/ledger-evidence-policy";
import {
  initialVatFirstPhase,
  phaseAfterAiVatExtract,
  phaseAfterVatAsk,
  vatFirstDetailsUnlocked,
  vatFirstReadyToSave,
  type VatFirstPhase,
} from "@/lib/ledger-vat-first";
import { guessTypeFromDescription } from "@/lib/ledger-labels";
import {
  EXTRACT_RECEIPT_MAX,
  extractOwnerBookFromReceipt,
} from "@/lib/owner-books-ai";
import { friendlyFirestoreWriteError } from "@/lib/receipts";
import {
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function statusClass(status: BillNoticeStatus) {
  switch (status) {
    case "accepted":
      return "bill-notice-status is-accepted";
    case "rejected":
      return "bill-notice-status is-rejected";
    case "void":
      return "bill-notice-status is-void";
    default:
      return "bill-notice-status is-pending";
  }
}

type Props = {
  actorId: string;
  isOwner: boolean;
  staffName: string;
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
};

/**
 * ตารางแจ้งบิลบน /ledger/ — พนักงานเสนอบิลค่าไฟ/น้ำ ฯลฯ
 * เจ้าของรับแล้วรวมเข้า บช.เจ้าของ เมื่อวันที่·รายการ·รูป·ยอดครบ
 */
export function BillNoticeLedgerPanel({
  actorId,
  isOwner,
  staffName,
  forceOpen = false,
  onForceOpenConsumed,
}: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<BillNotice[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [liveLimit, setLiveLimit] = useState(BILL_NOTICE_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BillNotice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    urls: string[];
    title: string;
    entryDateMs?: number;
  } | null>(null);

  useBodyScrollLock(adding || !!editing || !!imagePreview);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      onForceOpenConsumed?.();
    }
  }, [forceOpen, onForceOpenConsumed]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    return subscribeBillNoticesPage(
      liveLimit,
      (page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "โหลดแจ้งบิลไม่สำเร็จ");
        setLoading(false);
      },
    );
  }, [open, liveLimit]);

  const summary = useMemo(() => summarizeBillNotices(entries), [entries]);
  const pendingCount = summary.pendingCount;

  async function onAccept(row: BillNotice) {
    if (!isOwner) return;
    const ready = isBillNoticeReadyForOwnerBooks(row);
    if (!ready.ok) {
      setError(ready.message);
      return;
    }
    if (
      !window.confirm(
        `รับบิล «${row.description}» ฿${formatPlainNumber(row.amountOut)} เข้า บช.เจ้าของ?`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await acceptBillNotice({ id: row.id, verifiedBy: actorId });
    } catch (err) {
      setError(friendlyFirestoreWriteError(err, "รับบิลไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(row: BillNotice) {
    if (!isOwner) return;
    if (!window.confirm(`ไม่รับบิล «${row.description}»?`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      await rejectBillNotice({ id: row.id, verifiedBy: actorId });
    } catch (err) {
      setError(friendlyFirestoreWriteError(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(row: BillNotice) {
    const canDelete = isOwner || row.createdBy === actorId;
    if (!canDelete) return;
    if (row.status !== "pending" && !isOwner) {
      setError("ลบได้เฉพาะรายการที่รอเจ้าของ");
      return;
    }
    if (!window.confirm(`ลบแจ้งบิล «${row.description}»?`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      await deleteBillNotice(row.id);
    } catch (err) {
      setError(friendlyFirestoreWriteError(err, "ลบไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <aside className="bill-notice-panel" aria-label="ตารางแจ้งบิล">
      <button
        type="button"
        className="bill-notice-panel-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="bill-notice-panel-toggle-left">
          <span className="bill-notice-panel-title">แจ้งบิล</span>
          <span className="bill-notice-panel-meta">
            {pendingCount > 0
              ? `รอเจ้าของ ${pendingCount} · ฿${formatPlainNumber(summary.pendingSum)}`
              : "ค่าไฟ · ค่าน้ำ · อื่นๆ → บช.เจ้าของ"}
          </span>
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>

      {open ? (
        <div className="bill-notice-panel-body">
          <p className="muted bill-notice-hint">
            พนักงานถ่ายบิลเสนอ · เจ้าของรับเข้า บช.เจ้าของ
          </p>

          {entries.length > 0 ? (
            <div className="bill-notice-summary" aria-label="วิเคราะห์สรุปแจ้งบิล">
              <p className="bill-notice-summary-line">
                <span className="bill-notice-summary-text">
                  รอ {summary.pendingCount} · ฿{formatPlainNumber(summary.pendingSum)}
                  {" · "}
                  เข้าแล้ว {summary.acceptedCount} · ฿
                  {formatPlainNumber(summary.acceptedSum)}
                  {summary.byLabel.length
                    ? ` · ${summary.byLabel
                        .map((b) => `${b.label} ${formatPlainNumber(b.sum)}`)
                        .join(" · ")}`
                    : ""}
                </span>
              </p>
            </div>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
          {loading ? <p className="empty">กำลังโหลดแจ้งบิล…</p> : null}

          {!loading && entries.length === 0 ? (
            <p className="empty">ยังไม่มีแจ้งบิล — กดเพิ่มบิลด้านล่าง</p>
          ) : !loading ? (
            <div className="sheet-wrap bill-notice-panel-table-wrap">
              <table className="sheet-table bill-notice-slim">
                <thead>
                  <tr>
                    <th className="col-date">วันที่</th>
                    <th className="col-desc">รายการ</th>
                    <th className="col-photo">บิล</th>
                    <th className="col-out">ออก</th>
                    <th className="col-note">note</th>
                    <th className="col-status">สถานะ</th>
                    <th className="col-act" aria-label="จัดการ" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row) => {
                    const urls = getBillNoticeReceiptUrls(row);
                    const canEdit =
                      row.status === "pending" &&
                      (isOwner || row.createdBy === actorId);
                    const canDelete =
                      row.status !== "accepted" &&
                      (isOwner ||
                        (row.createdBy === actorId && row.status === "pending"));
                    const tip = [
                      row.description,
                      row.staffName ? `โดย ${row.staffName}` : "",
                      row.note,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr
                        key={row.id}
                        className={[
                          "row-out",
                          row.status === "pending" ? "is-bill-pending" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        title={tip}
                      >
                        <td className="col-date">
                          <SheetDateCell ms={row.date} era="be" />
                        </td>
                        <td className="col-desc">
                          {canEdit ? (
                            <button
                              type="button"
                              className="desc-link bill-notice-line"
                              title={tip || "แตะเพื่อแก้ไข"}
                              onClick={() => {
                                setError(null);
                                setEditing(row);
                              }}
                            >
                              {row.description || "—"}
                            </button>
                          ) : (
                            <span className="bill-notice-line" title={tip}>
                              {row.description || "—"}
                            </span>
                          )}
                        </td>
                        <td className="col-photo">
                          {urls.length ? (
                            <EntryPhotoIndicator
                              imageUrls={urls}
                              label={row.description || "บิล"}
                              onView={(viewUrls) =>
                                setImagePreview({
                                  urls: viewUrls,
                                  title: row.description || "บิล",
                                  entryDateMs: row.date,
                                })
                              }
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="col-out">
                          {formatPlainNumber(row.amountOut)}
                        </td>
                        <td className="col-note">
                          <span className="bill-notice-line" title={row.note || undefined}>
                            {row.note || "—"}
                          </span>
                        </td>
                        <td className="col-status">
                          <span
                            className={statusClass(row.status)}
                            title={
                              row.status === "pending"
                                ? "รอเจ้าของ"
                                : row.status === "accepted"
                                  ? "เข้าร้านแล้ว"
                                  : undefined
                            }
                          >
                            {shortLabelBillNoticeStatus(row.status)}
                          </span>
                        </td>
                        <td className="col-act">
                          <div className="bill-notice-act-row">
                            {row.status === "pending" && isOwner ? (
                              <>
                                <button
                                  type="button"
                                  className="ghost-btn bill-notice-act bill-notice-accept"
                                  disabled={busyId === row.id}
                                  title="รับเข้า บช.เจ้าของ"
                                  onClick={() => void onAccept(row)}
                                >
                                  รับ
                                </button>
                                <button
                                  type="button"
                                  className="ghost-btn bill-notice-act"
                                  disabled={busyId === row.id}
                                  title="ไม่รับบิล"
                                  onClick={() => void onReject(row)}
                                >
                                  ไม่
                                </button>
                              </>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                className="ghost-btn icon-btn bill-notice-act"
                                aria-label="ลบ"
                                title="ลบ"
                                disabled={busyId === row.id}
                                onClick={() => void onDelete(row)}
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {hasMore && liveLimit < BILL_NOTICE_LIVE_MAX ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                setLiveLimit((n) =>
                  Math.min(BILL_NOTICE_LIVE_MAX, n + BILL_NOTICE_PAGE_SIZE),
                )
              }
            >
              โหลดเพิ่ม
            </button>
          ) : null}

          <button
            type="button"
            className="primary-btn action-out bill-notice-panel-add"
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
          >
            เพิ่มแจ้งบิล
          </button>
        </div>
      ) : null}

      {adding ? (
        <BillNoticeFormModal
          mode="add"
          actorId={actorId}
          staffName={staffName}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
        />
      ) : null}
      {editing ? (
        <BillNoticeFormModal
          mode="edit"
          actorId={actorId}
          staffName={staffName}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
        />
      ) : null}
      {imagePreview ? (
        <ImagePreviewModal
          urls={imagePreview.urls}
          title={imagePreview.title}
          entryDateMs={imagePreview.entryDateMs}
          showCaptureMeta
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </aside>
  );
}

function BillNoticeFormModal({
  mode,
  actorId,
  staffName,
  entry,
  onClose,
  onSaved,
  onError,
}: {
  mode: "add" | "edit";
  actorId: string;
  staffName: string;
  entry?: BillNotice;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [date, setDate] = useState(
    entry ? todayInputValue(new Date(entry.date)) : todayInputValue(),
  );
  const [description, setDescription] = useState(entry?.description || "");
  const [amount, setAmount] = useState(
    entry?.amountOut ? String(entry.amountOut) : "",
  );
  const [note, setNote] = useState(entry?.note || "");
  const [receiptUrls, setReceiptUrls] = useState<string[]>(() =>
    entry ? getBillNoticeReceiptUrls(entry) : [],
  );
  const [vatFirstPhase, setVatFirstPhase] = useState<VatFirstPhase>(() =>
    mode === "add" ? initialVatFirstPhase() : "form",
  );
  const [hasVat, setHasVat] = useState(Boolean(entry?.hasVat));
  const [vatInputStr, setVatInputStr] = useState(() =>
    entry?.hasVat && (entry.vatInput || 0) > 0 ? String(entry.vatInput) : "",
  );
  const [vatInvoiceNo, setVatInvoiceNo] = useState(entry?.vatInvoiceNo || "");
  const [vatSource, setVatSource] = useState<VatSource>(
    () => (entry?.vatSource as VatSource) || "",
  );
  const [vatVerified, setVatVerified] = useState(Boolean(entry?.vatVerified));
  const [aiVatReason, setAiVatReason] = useState("");
  const [extractSlipOnly, setExtractSlipOnly] = useState(false);
  const [extractGoodsOnly, setExtractGoodsOnly] = useState(false);
  const [extractDocKind, setExtractDocKind] = useState("");
  const [evidenceDocAck, setEvidenceDocAck] = useState(false);
  const [pendingAiVat, setPendingAiVat] = useState<number | null>(null);
  /** AI อ่านรูปอัตโนมัติเมื่อแนบบิล — ปิดได้ถ้าจะกรอกเอง (edit) */
  const [aiAssist, setAiAssist] = useState(true);
  const [typeSource, setTypeSource] = useState(
    entry?.typeSource || (mode === "edit" ? "staff" : "heuristic"),
  );
  const [extractStatus, setExtractStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  const lastExtractKeyRef = useRef("");
  const extractBusyRef = useRef(false);
  const descriptionRef = useRef(description);
  const amountRef = useRef(amount);
  const noteRef = useRef(note);
  const vatFirstPhaseRef = useRef(vatFirstPhase);
  descriptionRef.current = description;
  amountRef.current = amount;
  noteRef.current = note;
  vatFirstPhaseRef.current = vatFirstPhase;

  const useVatFirst = mode === "add";
  const detailsUnlocked = !useVatFirst || vatFirstDetailsUnlocked(vatFirstPhase);
  const vatInputNum = parseVatInputStr(vatInputStr);

  useBodyScrollLock(true);

  function reportError(msg: string) {
    setFormError(msg);
    onError(msg);
  }

  function chooseHasVatDocument(yes: boolean) {
    const next = phaseAfterVatAsk(yes);
    setHasVat(yes);
    setVatVerified(false);
    setVatInputStr("");
    setVatInvoiceNo("");
    setVatSource("");
    setPendingAiVat(null);
    setAiVatReason("");
    setExtractSlipOnly(false);
    setExtractGoodsOnly(false);
    setExtractDocKind("");
    setEvidenceDocAck(false);
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
      reportError("ใส่ยอดภาษีมูลค่าเพิ่ม (บาท) จากเอกสารก่อน");
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
    setExtractSlipOnly(false);
    setExtractGoodsOnly(false);
    setExtractDocKind("");
    setEvidenceDocAck(false);
    setExtractStatus("idle");
    lastExtractKeyRef.current = "";
  }

  async function runExtractFromPhotos(urls: string[], force = false) {
    const refs = urls
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, EXTRACT_RECEIPT_MAX);
    if (!refs.length) return;
    const key = refs.join("|");
    if (!force && (key === lastExtractKeyRef.current || extractBusyRef.current)) return;
    extractBusyRef.current = true;
    setExtractStatus("loading");
    setExtractError(null);
    const inVatFirstUpload =
      useVatFirst &&
      (vatFirstPhaseRef.current === "upload" ||
        vatFirstPhaseRef.current === "confirm_ai" ||
        vatFirstPhaseRef.current === "manual");
    try {
      const result = await extractOwnerBookFromReceipt(refs);
      lastExtractKeyRef.current = key;
      // Keep accounting date — AI must not overwrite (พ.ศ. years corrupt the field).
      if (result.description) {
        const bucket = billNoticeBucketLabel(result.description);
        const nextDesc =
          bucket !== "อื่นๆ" ? bucket : result.description.trim();
        if (force || mode === "add" || !descriptionRef.current.trim()) {
          setDescription(nextDesc);
        }
      }
      if (result.amountOut != null) {
        if (force || mode === "add" || !amountRef.current.trim()) {
          setAmount(String(result.amountOut));
        }
      }
      if (result.note) {
        if (force || mode === "add" || !noteRef.current.trim()) {
          setNote(result.note);
        }
      }
      setTypeSource("ai");
      setAiVatReason(result.vatReason || result.reason || "");
      setExtractSlipOnly(Boolean(result.slipOnly));
      setExtractGoodsOnly(Boolean(result.goodsOnly));
      setExtractDocKind(String(result.docKind || ""));
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
      }
      setExtractStatus("ready");
    } catch (err) {
      setExtractStatus("error");
      setExtractError((err as Error).message || "อ่านบิลไม่สำเร็จ");
      if (inVatFirstUpload) {
        setPendingAiVat(null);
        setVatFirstPhase("manual");
      }
    } finally {
      extractBusyRef.current = false;
    }
  }

  function onReceiptUrlsChange(next: string[]) {
    const prev = receiptUrls;
    setReceiptUrls(next);
    if (!aiAssist && !useVatFirst) return;
    const added = next.some((u) => !prev.includes(u));
    if (added) void runExtractFromPhotos(next);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    onError(null);
    try {
      const dateMs = parseDateInput(date);
      const amountOut = Number(amount);
      const desc = description.trim();
      if (!dateMs) throw new Error("ต้องใส่วันที่บิล");
      if (!desc) throw new Error("ต้องใส่รายการ");
      if (!(amountOut > 0)) throw new Error("ต้องใส่จำนวนเงินออก");
      const vatNum = parseVatInputStr(vatInputStr);
      if (
        useVatFirst &&
        !vatFirstReadyToSave({
          phase: vatFirstPhase,
          hasVat,
          vatVerified,
          vatInput: vatNum,
        })
      ) {
        throw new Error(
          hasVat
            ? "ยืนยันยอดภาษีมูลค่าเพิ่มให้ตรงเอกสารก่อนบันทึก"
            : "ทำขั้นตอน VAT ให้ครบก่อนบันทึก",
        );
      }
      if (
        mode === "add" &&
        !evidenceReadyToSave({
          required: evidenceAckRequired(),
          acked: evidenceDocAck,
        })
      ) {
        throw new Error("ติ๊กยืนยันเรื่องเอกสารหลักฐานก่อนบันทึก");
      }
      if (hasVat && vatNum <= 0) {
        throw new Error("มี VAT — ใส่ยอดภาษีซื้อจากบิล");
      }
      // Utility bills are sga; keep heuristic only when it already yields sga/asset.
      const guessed = guessTypeFromDescription(desc) || "sga";
      const type = guessed === "cogs" ? "sga" : guessed;
      const source =
        typeSource === "ai" && extractStatus === "ready" ? "ai" : "staff";
      const vatPayload = {
        hasVat,
        vatInput: hasVat ? vatNum : 0,
        vatInvoiceNo: hasVat ? vatInvoiceNo.trim() : "",
        vatSource: hasVat ? vatSource || "manual" : "",
        vatVerified: hasVat ? vatVerified : false,
      };
      if (mode === "add") {
        await addBillNotice({
          date: dateMs,
          description: desc,
          amountOut,
          type,
          typeSource: source,
          note,
          receiptUrls,
          createdBy: actorId,
          staffName,
          ...vatPayload,
          evidenceDocPolicy: evidenceDocPolicy(desc),
          evidenceDocAck: true,
        });
      } else if (entry) {
        await updateBillNotice(entry.id, {
          date: dateMs,
          description: desc,
          amountOut,
          type,
          typeSource: source,
          note,
          receiptUrls,
          staffName,
          ...vatPayload,
        });
      }
      onSaved();
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    if (!window.confirm("ลบแจ้งบิลนี้?")) return;
    setBusy(true);
    try {
      await deleteBillNotice(entry.id);
      onSaved();
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "ลบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal is-module-form" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "เพิ่มแจ้งบิล" : "แก้ไขแจ้งบิล"}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">
            {mode === "add" ? "เพิ่มแจ้งบิล" : "แก้ไขแจ้งบิล"}
          </h2>
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
        {entry ? (
          <EntryTimestampsMeta
            entryDate={entry.date}
            createdAt={entry.createdAt}
            updatedAt={entry.updatedAt}
            era="be"
          />
        ) : null}
        {formError ? <p className="error-text ot-form-error">{formError}</p> : null}

        {useVatFirst && vatFirstPhase === "ask" ? (
          <VatFirstAskPanel onChooseHasVat={chooseHasVatDocument} onClose={onClose} />
        ) : null}

        {useVatFirst &&
        (vatFirstPhase === "upload" ||
          vatFirstPhase === "confirm_ai" ||
          vatFirstPhase === "manual") ? (
          <VatFirstCapturePanel
            phase={vatFirstPhase}
            receiptUrls={receiptUrls}
            onReceiptUrlsChange={(next) => {
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
            onError={reportError}
            maxPhotos={BILL_NOTICE_RECEIPT_MAX}
            storageFolder="bill-notices"
            storageSlotKey={`${mode}-${entry?.id || actorId || "new"}`}
            extractStatus={extractStatus}
            aiVatReason={aiVatReason}
            pendingAiVat={pendingAiVat}
            vatInputStr={vatInputStr}
            onVatInputStrChange={(value) => {
              setVatInputStr(value);
              setVatSource("manual");
              setVatVerified(false);
            }}
            onConfirmAi={confirmAiVatMatches}
            onRejectAi={rejectAiVat}
            onConfirmManual={confirmManualVat}
            onResetAsk={resetVatFirstAsk}
            onRereadAi={() => {
              lastExtractKeyRef.current = "";
              setVatFirstPhase("upload");
              void runExtractFromPhotos(receiptUrls, true);
            }}
            onClose={onClose}
            manualInputId="bn-vat-manual"
          />
        ) : null}

        {detailsUnlocked ? (
        <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
          {useVatFirst ? (
            <VatFirstFormSummary
              hasVat={hasVat}
              vatInput={vatInputNum}
              vatSource={vatSource}
              onEditVat={() => {
                setVatVerified(false);
                setVatFirstPhase("manual");
              }}
            />
          ) : entry?.hasVat ? (
            <p className="muted vat-first-summary-no">
              VAT จากแจ้งบิล · {entry.vatInput || 0} บาท
              {entry.vatVerified ? " · ยืนยันแล้ว" : ""}
            </p>
          ) : null}
          {mode === "add" ? (
            <EvidenceDocNotice
              description={description}
              acked={evidenceDocAck}
              onAckChange={setEvidenceDocAck}
              slipOnly={extractSlipOnly}
              goodsOnly={extractGoodsOnly}
              vatReason={aiVatReason}
              docKind={extractDocKind}
              hasVat={hasVat}
              disabled={busy}
              idPrefix="bn-evidence"
            />
          ) : null}

          <PhotoAttachMultiField
            label="อัพบิล / แคปแชท"
            values={receiptUrls}
            onChange={onReceiptUrlsChange}
            onError={reportError}
            max={BILL_NOTICE_RECEIPT_MAX}
            storageFolder="bill-notices"
            storageSlotKey={`${mode}-${entry?.id || actorId || "new"}`}
            hint={
              useVatFirst
                ? hasVat
                  ? "เพิ่มรูปได้ · VAT ยืนยันแล้ว"
                  : "บิล หรือแคปแชทถ้าไม่มีบิล · AI อ่านยอด"
                : "บิลหรือแคปแชท — AI อ่านวันที่ รายการ ยอด"
            }
          />
          {!useVatFirst ? (
            <label className="bill-notice-ai-toggle">
              <input
                type="checkbox"
                checked={aiAssist}
                onChange={(e) => setAiAssist(e.target.checked)}
              />
              AI อ่านรูปให้อัตโนมัติ
            </label>
          ) : null}
          {!useVatFirst && extractStatus === "loading" ? (
            <p className="muted form-hint-inline">AI กำลังอ่านบิล…</p>
          ) : null}
          {!useVatFirst && extractStatus === "ready" ? (
            <p className="muted form-hint-inline">
              อ่านจากรูปแล้ว — ไม่พอใจแก้เองได้ทุกช่อง หรืออ่านอีกครั้ง
            </p>
          ) : null}
          {!useVatFirst && extractStatus === "error" && extractError ? (
            <p className="error-text ot-form-error">{extractError}</p>
          ) : null}
          {receiptUrls.length ? (
            <div className="entry-actions" style={{ marginBottom: "0.55rem" }}>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setPreviewUrls(receiptUrls)}
              >
                ดูรูป ({receiptUrls.length})
              </button>
              {!useVatFirst ? (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={extractStatus === "loading" || busy}
                  onClick={() => {
                    lastExtractKeyRef.current = "";
                    void runExtractFromPhotos(receiptUrls, true);
                  }}
                >
                  {extractStatus === "loading" ? "กำลังอ่าน…" : "อ่านจากรูปอีกครั้ง"}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="bn-date">วันที่</label>
            <input
              id="bn-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTypeSource("staff");
              }}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="bn-desc">รายการ</label>
            <input
              id="bn-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setTypeSource("staff");
              }}
              autoComplete="off"
              required
              placeholder="เช่น ค่าไฟ / ค่าน้ำ"
            />
            <div className="suggest-list" role="listbox" aria-label="รายการบิลหลัก">
              {BILL_NOTICE_PRESETS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="suggest-chip"
                  onClick={() => {
                    setDescription(item);
                    setTypeSource("staff");
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="bn-amount">เงินออก</label>
            <input
              id="bn-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setTypeSource("staff");
              }}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="bn-note">note</label>
            <input
              id="bn-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setTypeSource("staff");
              }}
              autoComplete="off"
              placeholder="เช่น รอบมิ.ย. / เลขมิเตอร์"
            />
          </div>

          <div className="entry-actions">
            <button type="submit" className="primary-btn" disabled={busy || extractStatus === "loading"}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
            {mode === "edit" ? (
              <button
                type="button"
                className="trash-btn"
                aria-label="ลบรายการ"
                title="ลบรายการ"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                <Trash2 size={16} />
              </button>
            ) : (
              <span aria-hidden style={{ width: "2.6rem" }} />
            )}
          </div>
        </form>
        ) : null}
        {previewUrls ? (
          <ImagePreviewModal
            urls={previewUrls}
            title="รูปบิล"
            entryDateMs={entry?.date ?? parseDateInput(date)}
            showCaptureMeta
            onClose={() => setPreviewUrls(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
