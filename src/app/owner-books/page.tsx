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
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { LedgerTypeField } from "@/components/LedgerTypeField";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  classifyLedgerTypeHeuristic,
  classifyLedgerTypeWithAi,
  resolveStoredTypeSource,
  type LedgerTypeSource,
} from "@/lib/ledger-ai";
import {
  BASE_TYPE_OPTIONS,
  frequentTypes,
  labelLedgerType,
} from "@/lib/ledger-labels";
import {
  addOwnerBookEntry,
  bulkUpdateOwnerBookTypes,
  deleteOwnerBookEntry,
  frequentOwnerDescriptions,
  getOwnerBookReceiptUrls,
  listOwnerBookEntries,
  OWNER_BOOKS_LIVE_MAX,
  OWNER_BOOKS_PAGE_SIZE,
  OWNER_BOOKS_RECEIPT_MAX,
  proposeOwnerBookVatInput,
  subscribeOwnerBooksPage,
  subscribeOwnerBooksTotalOut,
  updateOwnerBookEntry,
  type OwnerBookEntry,
} from "@/lib/owner-books";
import { extractOwnerBookFromReceipt } from "@/lib/owner-books-ai";
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
import { formatVatMoney } from "@/lib/vat-number-format";

const BULK_TYPE_OPTIONS = BASE_TYPE_OPTIONS.filter((o) => o.value !== "auto");
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
  const [imagePreview, setImagePreview] = useState<{
    urls: string[];
    title: string;
    entryDateMs?: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [searchPool, setSearchPool] = useState<OwnerBookEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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
    setSelectedIds(new Set());
  }, [deferredQuery]);

  const visibleIds = useMemo(() => filteredEntries.map((r) => r.id), [filteredEntries]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

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

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (visibleIds.length === 0) return prev;
      const allOn = visibleIds.every((id) => prev.has(id));
      if (allOn) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  function clearSelected() {
    setSelectedIds(new Set());
  }

  async function onBulkRetype(type: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    setError(null);
    try {
      await bulkUpdateOwnerBookTypes(ids, type);
      setSelectedIds(new Set());
    } catch (err) {
      setError(friendlyFirestoreWriteError(err, "จัดประเภทกลุ่มไม่สำเร็จ"));
    } finally {
      setBulkBusy(false);
    }
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

  const isOwner = staff?.role === "owner";

  return (
    <div className="owner-books-page module-page">
      {isOwner ? <OwnerBooksModeSwitch active="out" /> : null}
      <div className="balance-bar owner-books-balance">
        <span>รวมออก</span>
        <strong>{totalOut == null ? "…" : formatBaht(totalOut)}</strong>
        <button
          type="button"
          className="owner-books-export-link"
          disabled={exporting || loading || (!entries.length && !searchPool?.length)}
          onClick={() => void onExportTables()}
          title="ส่งออก Excel (ใช้ไม่บ่อย)"
        >
          {exporting ? "…" : "Excel"}
        </button>
      </div>

      <div className="table-search owner-books-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา…"
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
              นับ {calcSummary.includedCount}
              {!deferredQuery && hasMore ? "+" : ""}
              {calcSummary.excludedCount > 0
                ? ` · ไม่นับ ${calcSummary.excludedCount}`
                : ""}
            </span>
            <strong>{formatBaht(calcSummary.includedSum)}</strong>
          </p>
          {excludedIds.size > 0 ? (
            <div className="owner-calc-actions">
              <button type="button" className="ghost-btn owner-calc-clear" onClick={clearExcluded}>
                ล้างการไม่รวม
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && filteredEntries.length > 0 ? (
        <div className="bulk-status-toolbar" role="group" aria-label="จัดประเภทหลายรายการ">
          <button
            type="button"
            className="ghost-btn bulk-status-chip"
            disabled={bulkBusy || !visibleIds.length}
            onClick={toggleSelectAllVisible}
          >
            {allVisibleSelected ? "ยกเลิกที่แสดง" : `เลือกที่แสดง (${visibleIds.length})`}
          </button>
          {selectedIds.size > 0 ? (
            <div className="bulk-status-actions" role="group" aria-label="ตั้งประเภทกลุ่ม">
              <span className="bulk-status-count">เลือก {selectedIds.size} รายการ</span>
              {BULK_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="ghost-btn bulk-status-btn"
                  disabled={bulkBusy}
                  onClick={() => void onBulkRetype(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                className="ghost-btn bulk-status-clear"
                disabled={bulkBusy}
                onClick={clearSelected}
              >
                ยกเลิก
              </button>
            </div>
          ) : (
            <p className="muted bulk-status-hint">ติ๊กหลายแถว แล้วกดประเภท</p>
          )}
        </div>
      ) : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — กดบันทึกเงินออกเพื่อเริ่ม</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="bulk-check-col" aria-label="เลือก">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={toggleSelectAllVisible}
                      aria-label="เลือกทั้งหมดที่แสดง"
                    />
                  </th>
                  <th className="col-exclude" aria-label="ไม่รวม" title="ไม่รวมในยอด" />
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-out">ออก</th>
                  <th className="col-vat" title="ภาษีซื้อ">VAT</th>
                  <th className="col-type">ประเภท</th>
                  <th className="col-note">note</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((row) => {
                  const excluded = excludedIds.has(row.id);
                  const selected = selectedIds.has(row.id);
                  const openEdit = () => setEditing(row);
                  return (
                  <tr
                    key={row.id}
                    className={[
                      "row-out",
                      "owner-row-tappable",
                      excluded ? "is-excluded" : "",
                      selected ? "is-bulk-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="bulk-check-col" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`เลือก ${row.description}`}
                      />
                    </td>
                    <td className="col-exclude" onClick={(e) => e.stopPropagation()}>
                      <label className="owner-exclude-check" title="ไม่รวมในยอด">
                        <input
                          type="checkbox"
                          checked={excluded}
                          onChange={() => toggleExcluded(row.id)}
                          aria-label={`ไม่รวม ${row.description}`}
                        />
                      </label>
                    </td>
                    <td className="col-date" onClick={openEdit}>
                      {formatDateShort(row.date)}
                    </td>
                    <td className="col-desc">
                      <div className="desc-with-photo">
                        <button
                          type="button"
                          className="desc-link"
                          title="แตะเพื่อแก้ไข · ลบได้ในกล่อง"
                          onClick={openEdit}
                        >
                          {row.description}
                        </button>
                        {getOwnerBookReceiptUrls(row).length ? (
                          <EntryPhotoIndicator
                            imageUrls={getOwnerBookReceiptUrls(row)}
                            label={row.description}
                            onView={(urls) =>
                              setImagePreview({
                                urls,
                                title: row.description,
                                entryDateMs: row.date,
                              })
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="photo-status"
                            onClick={openEdit}
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
                    <td className="col-out" onClick={openEdit}>
                      {row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}
                    </td>
                    <td className="col-vat" onClick={openEdit}>
                      {row.hasVat && (row.vatInput || 0) > 0 ? (
                        <span className="owner-vat-badge" title="ภาษีซื้อ">
                          {formatVatMoney(row.vatInput || 0)}
                        </span>
                      ) : (
                        <span className="muted owner-vat-empty">—</span>
                      )}
                    </td>
                    <td className="col-type" onClick={openEdit}>
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        {row.type ? labelLedgerType(row.type) : "—"}
                      </span>
                    </td>
                    <td className="col-note" title={row.note || ""} onClick={openEdit}>
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
          entryDateMs={imagePreview.entryDateMs}
          showCaptureMeta
          onClose={() => setImagePreview(null)}
        />
      ) : null}

      <ModuleTabDock
        ariaLabel="บันทึกเงินออก"
        formOpen={adding}
        onAdd={() => setAdding(true)}
        addLabel="+ ออก"
        variant="glass-out"
      />
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
  const [hasVat, setHasVat] = useState(Boolean(entry?.hasVat));
  const [vatInputStr, setVatInputStr] = useState(() =>
    entry?.hasVat && (entry.vatInput || 0) > 0 ? String(entry.vatInput) : "",
  );
  const [vatInvoiceNo, setVatInvoiceNo] = useState(entry?.vatInvoiceNo || "");
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
  const [extractStatus, setExtractStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [extractError, setExtractError] = useState<string | null>(null);
  const lastExtractKeyRef = useRef("");
  const extractBusyRef = useRef(false);
  const descriptionRef = useRef(description);
  const amountRef = useRef(amount);
  const noteRef = useRef(note);
  const ownerLockedRef = useRef(ownerLocked);
  descriptionRef.current = description;
  amountRef.current = amount;
  noteRef.current = note;
  ownerLockedRef.current = ownerLocked;

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

  async function runExtractFromPhotos(urls: string[]) {
    const refs = urls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 2);
    if (!refs.length) return;
    const key = refs.join("|");
    if (key === lastExtractKeyRef.current || extractBusyRef.current) return;
    extractBusyRef.current = true;
    setExtractStatus("loading");
    setExtractError(null);
    try {
      const result = await extractOwnerBookFromReceipt(refs);
      lastExtractKeyRef.current = key;
      if (result.date) setDate(result.date);
      if (result.description) {
        if (mode === "add" || !descriptionRef.current.trim()) {
          setDescription(result.description);
        }
      }
      if (result.amountOut != null) {
        if (mode === "add" || !amountRef.current.trim()) {
          setAmount(String(result.amountOut));
        }
      }
      if (result.note) {
        if (mode === "add" || !noteRef.current.trim()) {
          setNote(result.note);
        }
      }
      if (!ownerLockedRef.current && result.type) {
        setTypeMode("auto");
        setPreviewType(result.type);
        setPreviewReason(result.reason || "อ่านจากรูปใบเสร็จ");
        setPreviewSource("ai");
        setPreviewStatus("ready");
        setPreviewError(null);
      }
      setExtractStatus("ready");
    } catch (err) {
      setExtractStatus("error");
      setExtractError((err as Error).message || "อ่านใบเสร็จไม่สำเร็จ");
    } finally {
      extractBusyRef.current = false;
    }
  }

  function onReceiptUrlsChange(next: string[]) {
    const prev = receiptUrls;
    setReceiptUrls(next);
    const added = next.some((u) => !prev.includes(u));
    if (added) void runExtractFromPhotos(next);
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

      const amountOut = Number(amount);
      const vatInputNum = Number(String(vatInputStr).replace(/,/g, ""));
      const vatPayload = {
        hasVat,
        vatInput:
          hasVat && Number.isFinite(vatInputNum) && vatInputNum > 0
            ? vatInputNum
            : hasVat
              ? proposeOwnerBookVatInput(amountOut)
              : 0,
        vatInvoiceNo: hasVat ? vatInvoiceNo.trim() : "",
      };

      if (mode === "add") {
        await addOwnerBookEntry({
          date: parseDateInput(date),
          description,
          amountOut,
          type,
          typeSource,
          typeAiReason,
          createdBy,
          receiptUrls: urls,
          note,
          ...vatPayload,
        });
      } else if (entry) {
        await updateOwnerBookEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountOut,
          type,
          typeSource,
          typeAiReason,
          receiptUrls: urls,
          note,
          ...vatPayload,
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
          <div className="entry-toolbar-actions">
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
            ) : null}
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
        {entry ? (
          <EntryTimestampsMeta
            entryDate={entry.date}
            createdAt={entry.createdAt}
            updatedAt={entry.updatedAt}
          />
        ) : null}
        {formError ? <p className="error-text ot-form-error">{formError}</p> : null}
        <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
          <PhotoAttachMultiField
            label="รูปใบเสร็จ"
            values={receiptUrls}
            onChange={onReceiptUrlsChange}
            onError={reportError}
            max={OWNER_BOOKS_RECEIPT_MAX}
            storageFolder="owner-books"
            storageSlotKey={`${mode}-${entry?.id || createdBy || "new"}`}
            hint="ถ่ายหรือแนบ — AI ใส่วันที่ รายการ และยอดให้อัตโนมัติ"
          />
          {extractStatus === "loading" ? (
            <p className="muted form-hint-inline">AI กำลังอ่านใบเสร็จ…</p>
          ) : null}
          {extractStatus === "ready" ? (
            <p className="muted form-hint-inline">อ่านจากรูปแล้ว — ตรวจก่อนบันทึกได้</p>
          ) : null}
          {extractStatus === "error" && extractError ? (
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
              <button
                type="button"
                className="ghost-btn"
                disabled={extractStatus === "loading" || busy}
                onClick={() => {
                  lastExtractKeyRef.current = "";
                  void runExtractFromPhotos(receiptUrls);
                }}
              >
                {extractStatus === "loading" ? "กำลังอ่าน…" : "อ่านจากรูปอีกครั้ง"}
              </button>
            </div>
          ) : null}

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
              onChange={(e) => {
                const next = e.target.value;
                setAmount(next);
                if (hasVat && !vatInputStr.trim()) {
                  const n = Number(next);
                  if (Number.isFinite(n) && n > 0) {
                    setVatInputStr(String(proposeOwnerBookVatInput(n)));
                  }
                }
              }}
              required
            />
          </div>

          <fieldset className="owner-vat-box">
            <legend>ช่อง VAT · ภาษีซื้อ</legend>
            <label className="owner-vat-toggle">
              <input
                type="checkbox"
                checked={hasVat}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  setHasVat(on);
                  if (on) {
                    const n = Number(amount);
                    if ((!vatInputStr.trim() || Number(vatInputStr) <= 0) && n > 0) {
                      setVatInputStr(String(proposeOwnerBookVatInput(n)));
                    }
                  }
                }}
              />
              มีใบกำกับภาษี · หักภาษีซื้อได้
            </label>
            {hasVat ? (
              <>
                <div className="field">
                  <label htmlFor="ob-vat-input">
                    ภาษีซื้อ (บาท)
                    <span className="muted">
                      {" "}
                      · เสนอ{" "}
                      {formatVatMoney(
                        proposeOwnerBookVatInput(Number(amount) || 0),
                      )}{" "}
                      จากยอด×7/107
                    </span>
                  </label>
                  <input
                    id="ob-vat-input"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={vatInputStr}
                    disabled={busy}
                    placeholder={String(
                      proposeOwnerBookVatInput(Number(amount) || 0) || "",
                    )}
                    onChange={(e) => setVatInputStr(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ob-vat-inv">เลขที่ใบกำกับ (ถ้ามี)</label>
                  <input
                    id="ob-vat-inv"
                    value={vatInvoiceNo}
                    disabled={busy}
                    autoComplete="off"
                    placeholder="เช่น INV-001"
                    onChange={(e) => setVatInvoiceNo(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <p className="muted form-hint-inline">
                ติ๊กเมื่อบิลมี VAT — ยอดไปรวมภาษีซื้อในแท็บ VAT เดือนได้
              </p>
            )}
          </fieldset>

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
          <ImagePreviewModal
            urls={previewUrls}
            title="รูป"
            entryDateMs={entry?.date ?? parseDateInput(date)}
            showCaptureMeta
            onClose={() => setPreviewUrls(null)}
          />
        ) : null}
      </div>
      {saveStage ? (
        <AiSaveProgressModal stage={saveStage} detail={description.trim()} />
      ) : null}
    </div>
  );
}
