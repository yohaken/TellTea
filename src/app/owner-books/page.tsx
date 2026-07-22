"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { AiSaveProgressModal, type AiSaveStage } from "@/components/AiSaveProgressModal";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { LedgerTypeField } from "@/components/LedgerTypeField";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  classifyLedgerTypeHeuristic,
  classifyLedgerTypeWithAi,
  resolveStoredTypeSource,
  type LedgerTypeSource,
} from "@/lib/ledger-ai";
import { frequentTypes, labelLedgerType } from "@/lib/ledger-labels";
import {
  addOwnerBookEntry,
  deleteOwnerBookEntry,
  frequentOwnerDescriptions,
  getOwnerBookReceiptUrls,
  listOwnerBookEntries,
  OWNER_BOOKS_LIVE_MAX,
  OWNER_BOOKS_PAGE_SIZE,
  OWNER_BOOKS_RECEIPT_MAX,
  subscribeOwnerBooksPage,
  subscribeOwnerBooksTotalOut,
  updateOwnerBookEntry,
  type OwnerBookEntry,
} from "@/lib/owner-books";
import { friendlyFirestoreWriteError } from "@/lib/receipts";
import {
  formatBaht,
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { filterOwnerBookRows } from "@/lib/smart-search";
import { exportOwnerBooksXlsx } from "@/lib/xlsx-export";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export default function OwnerBooksPage() {
  return (
    <AuthGate>
      <OwnerBooksView />
    </AuthGate>
  );
}

function toDateInput(ms: number) {
  return todayInputValue(new Date(ms));
}

function OwnerBooksView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<OwnerBookEntry[]>([]);
  const [totalOut, setTotalOut] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLimit, setLiveLimit] = useState(OWNER_BOOKS_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<OwnerBookEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ urls: string[]; title: string } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [searchPool, setSearchPool] = useState<OwnerBookEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query.trim());

  useBodyScrollLock(adding || !!editing || !!imagePreview);

  useEffect(() => {
    if (staff && !can(staff, "ownerBooks")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "ownerBooks")) return;
    return subscribeOwnerBooksTotalOut(
      (n) => setTotalOut(n),
      (err) => setError(err.message || "โหลดยอดไม่สำเร็จ"),
    );
  }, [staff]);

  useEffect(() => {
    if (!can(staff, "ownerBooks")) return;
    setLoading(true);
    const unsub = subscribeOwnerBooksPage(
      liveLimit,
      (page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore);
        setLoading(false);
        setLoadingMore(false);
      },
      (err) => {
        setLoading(false);
        setLoadingMore(false);
        setError(err.message || "โหลดบัญชีไม่สำเร็จ");
      },
    );
    return unsub;
  }, [staff, liveLimit]);

  useEffect(() => {
    if (!deferredQuery) {
      setSearchPool(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void listOwnerBookEntries()
      .then((rows) => {
        if (!cancelled) setSearchPool(rows);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "ค้นหาไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deferredQuery]);

  const filteredEntries = useMemo(() => {
    const source = deferredQuery ? searchPool ?? entries : entries;
    return filterOwnerBookRows(source, deferredQuery);
  }, [entries, searchPool, deferredQuery]);

  useEffect(() => {
    setExcludedIds(new Set());
  }, [deferredQuery]);

  const calcSummary = useMemo(() => {
    let includedCount = 0;
    let includedSum = 0;
    let excludedCount = 0;
    let excludedSum = 0;
    for (const row of filteredEntries) {
      const amt = Number(row.amountOut) || 0;
      if (excludedIds.has(row.id)) {
        excludedCount += 1;
        excludedSum += amt;
      } else {
        includedCount += 1;
        includedSum += amt;
      }
    }
    return { includedCount, includedSum, excludedCount, excludedSum };
  }, [filteredEntries, excludedIds]);

  function toggleExcluded(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearExcluded() {
    setExcludedIds(new Set());
  }

  const showCalcSummary = !loading && filteredEntries.length > 0 && !searchLoading;

  async function onExportTables() {
    setExporting(true);
    setError(null);
    try {
      let rows: OwnerBookEntry[];
      if (deferredQuery) {
        rows = filterOwnerBookRows(searchPool ?? entries, deferredQuery);
      } else {
        rows = await listOwnerBookEntries();
      }
      exportOwnerBooksXlsx(rows);
    } catch (err) {
      setError((err as Error).message || "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  const loadMore = useCallback(() => {
    if (deferredQuery) return;
    if (!hasMore || loadingMore || liveLimit >= OWNER_BOOKS_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + OWNER_BOOKS_PAGE_SIZE, OWNER_BOOKS_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit, deferredQuery]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading || deferredQuery) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: "240px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, loading, hasMore, entries.length, deferredQuery]);

  if (!can(staff, "ownerBooks")) return null;

  return (
    <div>
      <div className="balance-bar">
        <span>รวมออก · บช.เจ้าของ</span>
        <strong>{totalOut == null ? "…" : formatBaht(totalOut)}</strong>
      </div>

      <div className="btn-row pnl-toolbar">
        <button
          type="button"
          className="primary-btn action-out"
          onClick={() => setAdding(true)}
        >
          บันทึกเงินออก
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={exporting || loading || (!entries.length && !searchPool?.length)}
          onClick={() => void onExportTables()}
        >
          {exporting ? "กำลังส่งออก..." : "ส่งออกตาราง Excel"}
        </button>
      </div>

      <div className="table-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา รายการ / ประเภท / note / ยอด / วันที่…"
          autoComplete="off"
          enterKeyHint="search"
          aria-label="ค้นหาในตาราง"
        />
        {query.trim() ? (
          <button
            type="button"
            className="ghost-btn table-search-clear"
            onClick={() => setQuery("")}
            aria-label="ล้างคำค้น"
          >
            ล้าง
          </button>
        ) : null}
      </div>
      {deferredQuery ? (
        <p className="muted table-search-meta">
          {searchLoading
            ? "กำลังค้นหาทั้งบัญชี…"
            : `พบ ${filteredEntries.length} รายการ`}
        </p>
      ) : null}

      {showCalcSummary ? (
        <div className="owner-calc-summary" aria-live="polite">
          <p className="owner-calc-line">
            <span>
              {deferredQuery ? "ผลค้นหา" : "รายการที่แสดง"}
              {" · "}
              นับ {calcSummary.includedCount} รายการ
              {!deferredQuery && hasMore ? " (โหลดเพิ่มได้)" : null}
            </span>
            <strong>{formatBaht(calcSummary.includedSum)}</strong>
          </p>
          {calcSummary.excludedCount > 0 ? (
            <p className="owner-calc-line owner-calc-excluded muted">
              <span>
                ไม่นับ {calcSummary.excludedCount} รายการ (−{formatBaht(calcSummary.excludedSum)})
              </span>
            </p>
          ) : null}
          <div className="owner-calc-actions">
            {excludedIds.size > 0 ? (
              <button type="button" className="ghost-btn owner-calc-clear" onClick={clearExcluded}>
                ล้างการไม่รวม
              </button>
            ) : (
              <span className="owner-calc-hint muted">ติ๊ก «ไม่รวม» เพื่อหักออกจากยอดชั่วคราว</span>
            )}
          </div>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — กดบันทึกเงินออกเพื่อเริ่ม</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="col-exclude" aria-label="ไม่รวม" />
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-out">ออก</th>
                  <th className="col-act">ประเภท</th>
                  <th className="col-note">note</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((row) => {
                  const excluded = excludedIds.has(row.id);
                  return (
                  <tr key={row.id} className={excluded ? "row-out is-excluded" : "row-out"}>
                    <td className="col-exclude">
                      <label className="owner-exclude-check" title="ไม่รวมในยอด">
                        <input
                          type="checkbox"
                          checked={excluded}
                          onChange={() => toggleExcluded(row.id)}
                          aria-label={`ไม่รวม ${row.description}`}
                        />
                      </label>
                    </td>
                    <td className="col-date">{formatDateShort(row.date)}</td>
                    <td className="col-desc">
                      <div className="desc-with-photo">
                        <button
                          type="button"
                          className="desc-link"
                          title="แตะเพื่อแก้ไข"
                          onClick={() => setEditing(row)}
                        >
                          {row.description}
                        </button>
                        {getOwnerBookReceiptUrls(row).length ? (
                          <EntryPhotoIndicator
                            imageUrls={getOwnerBookReceiptUrls(row)}
                            label={row.description}
                            onView={(urls) =>
                              setImagePreview({ urls, title: row.description })
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="photo-status"
                            onClick={() => setEditing(row)}
                            title="เพิ่มรูป"
                            aria-label="เพิ่มรูป"
                          >
                            <span className="photo-status-plus" aria-hidden>
                              +
                            </span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="col-out">
                      {row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}
                    </td>
                    <td className="col-act">
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        {row.type ? labelLedgerType(row.type) : "—"}
                      </span>
                    </td>
                    <td className="col-note" title={row.note || ""}>
                      {row.note || ""}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!deferredQuery ? <div ref={sentinelRef} className="load-more-sentinel" aria-hidden /> : null}
          {loadingMore && !deferredQuery ? <p className="empty">กำลังโหลดเพิ่ม...</p> : null}
          {!deferredQuery && !hasMore && entries.length > 0 ? (
            <p className="empty muted-foot">
              {liveLimit >= OWNER_BOOKS_LIVE_MAX && entries.length >= OWNER_BOOKS_LIVE_MAX
                ? `แสดงล่าสุด ${entries.length} รายการ`
                : `ครบทุกรายการแล้ว (${entries.length})`}
            </p>
          ) : null}
          {deferredQuery && !searchLoading && filteredEntries.length === 0 ? (
            <p className="empty">ไม่พบรายการที่ตรงกับ «{deferredQuery}»</p>
          ) : null}
        </>
      ) : null}

      {adding && actorId ? (
        <OwnerEntryModal
          mode="add"
          createdBy={actorId}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
        />
      ) : null}

      {editing && actorId ? (
        <OwnerEntryModal
          mode="edit"
          entry={editing}
          createdBy={actorId}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
        />
      ) : null}

      {imagePreview ? (
        <ImagePreviewModal
          urls={imagePreview.urls}
          title={imagePreview.title}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </div>
  );
}

function OwnerEntryModal({
  mode,
  entry,
  createdBy,
  onClose,
  onSaved,
  onError,
}: {
  mode: "add" | "edit";
  entry?: OwnerBookEntry;
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const initialSource = resolveStoredTypeSource(entry?.typeSource);
  const wasOwnerType = initialSource === "owner";
  const [date, setDate] = useState(entry ? toDateInput(entry.date) : todayInputValue());
  const [description, setDescription] = useState(entry?.description || "");
  const [amount, setAmount] = useState(entry ? String(entry.amountOut) : "");
  const [typeMode, setTypeMode] = useState(() =>
    wasOwnerType || initialSource === "legacy"
      ? (entry?.type || "").trim() || "auto"
      : "auto",
  );
  const [ownerLocked, setOwnerLocked] = useState(wasOwnerType);
  const [note, setNote] = useState(entry?.note || "");
  const [receiptUrls, setReceiptUrls] = useState<string[]>(() => getOwnerBookReceiptUrls(entry));
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveStage, setSaveStage] = useState<AiSaveStage | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [previewType, setPreviewType] = useState(entry?.type || "");
  const [previewReason, setPreviewReason] = useState(entry?.typeAiReason || "");
  const [previewSource, setPreviewSource] = useState<LedgerTypeSource>(
    entry ? initialSource : "heuristic",
  );
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    entry?.type ? "ready" : "idle",
  );
  const [previewError, setPreviewError] = useState<string | null>(null);

  const filteredSuggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 10);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 10);
  }, [description, suggestions]);

  useEffect(() => {
    void listOwnerBookEntries()
      .then((rows) => {
        setSuggestions(frequentOwnerDescriptions(rows));
        setTypeFreq(frequentTypes(rows));
      })
      .catch(() => {
        setSuggestions([]);
        setTypeFreq([]);
      });
  }, []);

  function reportError(msg: string) {
    setFormError(msg);
    onError(msg);
  }

  async function runOwnerPreview() {
    const text = description.trim();
    if (!text) {
      reportError("ใส่ชื่อรายการก่อนจัดประเภท");
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
    setBusy(true);
    setFormError("");
    onError("");
    try {
      const urls = receiptUrls.filter(Boolean).slice(0, OWNER_BOOKS_RECEIPT_MAX);
      if (urls.some((u) => u.startsWith("data:"))) {
        throw new Error(
          "รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่เพื่อบันทึกเข้าคลังหลักฐาน",
        );
      }

      let type = previewType || "cogs";
      let typeSource: LedgerTypeSource = previewSource;
      let typeAiReason = previewReason;

      if (ownerLocked && typeMode !== "auto") {
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
        setSaveStage("saving");
      }

      if (mode === "add") {
        await addOwnerBookEntry({
          date: parseDateInput(date),
          description,
          amountOut: Number(amount),
          type,
          typeSource,
          typeAiReason,
          createdBy,
          receiptUrls: urls,
          note,
        });
      } else if (entry) {
        await updateOwnerBookEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountOut: Number(amount),
          type,
          typeSource,
          typeAiReason,
          receiptUrls: urls,
          note,
        });
      }
      onSaved();
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
      setSaveStage(null);
    }
  }

  async function onDelete() {
    if (!entry) return;
    if (!window.confirm("ลบรายการนี้?")) return;
    setBusy(true);
    try {
      await deleteOwnerBookEntry(entry.id);
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
        aria-label={mode === "add" ? "บันทึกเงินออก" : "แก้ไขรายการ"}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">{mode === "add" ? "บันทึกเงินออก" : "แก้ไขรายการ"}</h2>
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
        {formError ? <p className="error-text ot-form-error">{formError}</p> : null}
        <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
          <div className="field">
            <label htmlFor="ob-date">วันที่</label>
            <input
              id="ob-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ob-desc">รายการ</label>
            <input
              id="ob-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            <label htmlFor="ob-amount">เงินออก</label>
            <input
              id="ob-amount"
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
            label="สลิป / รูปถ่าย"
            values={receiptUrls}
            onChange={setReceiptUrls}
            onError={reportError}
            max={OWNER_BOOKS_RECEIPT_MAX}
            storageFolder="owner-books"
            storageSlotKey={`${mode}-${entry?.id || createdBy || "new"}`}
            hint={`บันทึกไฟล์หลักฐานเข้าฐานข้อมูล · สูงสุด ${OWNER_BOOKS_RECEIPT_MAX} รูป`}
          />
          {receiptUrls.length ? (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginBottom: "0.55rem" }}
              onClick={() => setPreviewUrls(receiptUrls)}
            >
              ดูรูปทั้งหมด ({receiptUrls.length})
            </button>
          ) : null}

          <LedgerTypeField
            id="ob-type"
            isOwner
            mode="live"
            displayType={previewType}
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

          <div className="field">
            <label htmlFor="ob-note">note</label>
            <input
              id="ob-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="entry-actions">
            <button type="submit" className="primary-btn" disabled={busy}>
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
        {previewUrls ? (
          <ImagePreviewModal urls={previewUrls} title="สลิป / รูปถ่าย" onClose={() => setPreviewUrls(null)} />
        ) : null}
      </div>
      {saveStage ? (
        <AiSaveProgressModal stage={saveStage} detail={description.trim()} />
      ) : null}
    </div>
  );
}
