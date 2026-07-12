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
import { TypePicker } from "@/components/TypePicker";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { frequentTypes, guessTypeFromDescription } from "@/lib/ledger-labels";
import {
  addOwnerBookEntry,
  deleteOwnerBookEntry,
  frequentOwnerDescriptions,
  listOwnerBookEntries,
  OWNER_BOOKS_LIVE_MAX,
  OWNER_BOOKS_PAGE_SIZE,
  subscribeOwnerBooksPage,
  subscribeOwnerBooksTotalOut,
  updateOwnerBookEntry,
  type OwnerBookEntry,
} from "@/lib/owner-books";
import {
  compressImageForUpload,
  fileToReceiptDataUrl,
  saveImageToDevice,
} from "@/lib/receipts";
import {
  formatBaht,
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { filterOwnerBookRows } from "@/lib/smart-search";

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
  const { user, staff } = useAuth();
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
  const [query, setQuery] = useState("");
  const [searchPool, setSearchPool] = useState<OwnerBookEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query.trim());

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

      <div className="quick-actions">
        <button
          type="button"
          className="primary-btn action-out"
          onClick={() => setAdding(true)}
        >
          บันทึกเงินออก
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
          {searchLoading ? "กำลังค้นหาทั้งบัญชี…" : null}
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
                      <button
                        type="button"
                        className="desc-link"
                        title="แตะเพื่อแก้ไข"
                        onClick={() => setEditing(row)}
                      >
                        {row.description}
                      </button>
                    </td>
                    <td className="col-out">
                      {row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}
                    </td>
                    <td className="col-act">
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        {row.type || "—"}
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

      {adding && user?.email ? (
        <OwnerEntryModal
          mode="add"
          createdBy={user.email}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
        />
      ) : null}

      {editing && user?.email ? (
        <OwnerEntryModal
          mode="edit"
          entry={editing}
          createdBy={user.email}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
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
  const [date, setDate] = useState(entry ? toDateInput(entry.date) : todayInputValue());
  const [description, setDescription] = useState(entry?.description || "");
  const [amount, setAmount] = useState(entry ? String(entry.amountOut) : "");
  const [typeMode, setTypeMode] = useState(() => (entry?.type || "").trim() || "auto");
  const [note, setNote] = useState(entry?.note || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const autoType = useMemo(() => guessTypeFromDescription(description), [description]);
  const resolvedType = typeMode === "auto" ? autoType : typeMode;

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

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
  }, [receiptPreview]);

  async function handleReceiptFile(file: File | null) {
    if (!file) return;
    setNotice(null);
    try {
      const how = await saveImageToDevice(file);
      setNotice(
        how === "shared"
          ? "เปิดเมนูแชร์แล้ว — เลือกบันทึกรูปลงเครื่องได้"
          : "บันทึกรูปลงเครื่องแล้ว",
      );
      const compressed = await compressImageForUpload(file);
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      setReceiptFile(compressed);
      setReceiptPreview(URL.createObjectURL(compressed));
    } catch (err) {
      onError((err as Error).message || "ใช้รูปไม่สำเร็จ");
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let receiptUrl = entry?.receiptUrl || "";
      if (receiptFile) {
        receiptUrl = await fileToReceiptDataUrl(receiptFile);
      }
      if (mode === "add") {
        await addOwnerBookEntry({
          date: parseDateInput(date),
          description,
          amountOut: Number(amount),
          type: resolvedType,
          createdBy,
          receiptUrl,
          note,
        });
      } else if (entry) {
        await updateOwnerBookEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountOut: Number(amount),
          type: resolvedType,
          receiptUrl,
          note,
        });
      }
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
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
      onError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "บันทึกเงินออก" : "แก้ไขรายการ"}
      >
        <div className="entry-toolbar">
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
        {notice ? <p className="muted" style={{ margin: "0 0 0.55rem" }}>{notice}</p> : null}
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
          <TypePicker
            id="ob-type"
            value={typeMode}
            onChange={setTypeMode}
            frequent={typeFreq}
            autoHint={autoType}
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

          <div className="field">
            <span className="field-label">สลิป / รูปถ่าย</span>
            <div className="receipt-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => cameraRef.current?.click()}
              >
                ถ่ายรูป
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => galleryRef.current?.click()}
              >
                แนบรูป
              </button>
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => void handleReceiptFile(e.target.files?.[0] || null)}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void handleReceiptFile(e.target.files?.[0] || null)}
            />
            {receiptPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receiptPreview} alt="ตัวอย่างสลิป" className="receipt-preview" />
            ) : entry?.receiptUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.receiptUrl} alt="สลิปเดิม" className="receipt-preview" />
            ) : null}
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
      </div>
    </div>
  );
}
