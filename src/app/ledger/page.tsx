"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  addLedgerEntry,
  deleteLedgerEntry,
  frequentDescriptions,
  LEDGER_LIVE_MAX,
  LEDGER_PAGE_SIZE,
  listLedgerEntries,
  listRecentLedgerEntries,
  recomputeLedgerBalance,
  subscribeLedgerBalance,
  subscribeLedgerPage,
  updateLedgerEntry,
} from "@/lib/ledger";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { ImagePreviewModal } from "@/components/EntryPhotoCell";
import { TypePicker } from "@/components/TypePicker";
import { frequentTypes, guessTypeFromDescription, labelLedgerType } from "@/lib/ledger-labels";
import { loadCachedLedger, saveCachedLedger } from "@/lib/cache";
import {
  compressImageForUpload,
  fileToReceiptDataUrl,
  saveImageToDevice,
} from "@/lib/receipts";
import type { LedgerEntry } from "@/lib/types";
import { filterLedgerRows } from "@/lib/smart-search";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { exportLedgerXlsx } from "@/lib/xlsx-export";
import { Trash2, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export default function LedgerPage() {
  return (
    <AuthGate>
      <LedgerView />
    </AuthGate>
  );
}

function LedgerView() {
  const { actorId } = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [liveLimit, setLiveLimit] = useState(LEDGER_PAGE_SIZE);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [photoUploadRowId, setPhotoUploadRowId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);
  const [query, setQuery] = useState("");
  const [searchPool, setSearchPool] = useState<LedgerEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const photoEntryRef = useRef<LedgerEntry | null>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoGalleryRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const balanceRef = useRef<number | null>(null);
  const hasRowsRef = useRef(false);
  const deferredQuery = useDeferredValue(query.trim());

  useBodyScrollLock(!!adding || !!editing || !!photoUploadRowId || !!imagePreview);

  useLayoutEffect(() => {
    const cached = loadCachedLedger();
    if (cached?.entries.length) {
      setEntries(cached.entries);
      if (cached.balance != null) {
        setBalance(cached.balance);
        balanceRef.current = cached.balance;
      }
      setHasMore(cached.hasMore);
      setLoading(false);
      hasRowsRef.current = true;
    }
  }, []);

  const persistSnapshot = useCallback(
    (nextEntries: LedgerEntry[], nextHasMore: boolean, nextBalance: number | null) => {
      saveCachedLedger({
        entries: nextEntries.slice(0, LEDGER_PAGE_SIZE),
        hasMore: nextHasMore,
        balance: nextBalance,
      });
    },
    [],
  );

  useEffect(() => {
    const unsub = subscribeLedgerBalance(
      (next) => {
        setBalance(next);
        balanceRef.current = next;
        const cached = loadCachedLedger();
        if (cached) saveCachedLedger({ ...cached, balance: next });
      },
      (err) => {
        if (balanceRef.current == null) {
          setError(err.message || "โหลดยอดคงเหลือไม่สำเร็จ");
        }
      },
    );

    // One-time full recompute after this release so meta/ledger is correct
    // even if older aggregate reads failed silently.
    try {
      const seedKey = "telltea_balance_seed_v6";
      if (typeof window !== "undefined" && !window.localStorage.getItem(seedKey)) {
        void recomputeLedgerBalance()
          .then(() => window.localStorage.setItem(seedKey, "1"))
          .catch(() => {
            /* subscribe bootstrap still runs if meta missing */
          });
      }
    } catch {
      // ignore
    }

    return unsub;
  }, []);

  useEffect(() => {
    setError(null);
    if (hasRowsRef.current) setRefreshing(true);
    else setLoading(true);

    const unsub = subscribeLedgerPage(
      liveLimit,
      (page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore && liveLimit < LEDGER_LIVE_MAX);
        hasRowsRef.current = page.entries.length > 0;
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
        persistSnapshot(page.entries, page.hasMore, balanceRef.current);
      },
      (err) => {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        if (!hasRowsRef.current) {
          setError(err.message || "โหลดบัญชีไม่สำเร็จ");
        }
      },
    );

    return () => unsub();
  }, [liveLimit, persistSnapshot]);

  useEffect(() => {
    if (!deferredQuery) {
      setSearchPool(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void listLedgerEntries()
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
    return filterLedgerRows(source, deferredQuery);
  }, [entries, searchPool, deferredQuery]);

  const loadMore = useCallback(() => {
    if (deferredQuery) return;
    if (!hasMore || loadingMore || liveLimit >= LEDGER_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + LEDGER_PAGE_SIZE, LEDGER_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit, deferredQuery]);

  async function handleRowPhotoFile(file: File | null) {
    if (!file || !photoEntryRef.current) return;
    const row = photoEntryRef.current;
    try {
      const compressed = await compressImageForUpload(file);
      const receiptUrl = await fileToReceiptDataUrl(compressed);
      await updateLedgerEntry(row.id, { receiptUrl });
      saveImageToDevice(file).catch(() => {});
    } catch (err) {
      setError((err as Error).message || "ใช้รูปไม่สำเร็จ");
    } finally {
      setPhotoUploadRowId(null);
      photoEntryRef.current = null;
    }
  }

  async function onExportTables() {
    setExporting(true);
    setError(null);
    try {
      let rows: LedgerEntry[];
      if (deferredQuery) {
        rows = filterLedgerRows(searchPool ?? entries, deferredQuery);
      } else {
        rows = await listLedgerEntries();
      }
      exportLedgerXlsx(rows);
    } catch (err) {
      setError((err as Error).message || "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading || deferredQuery) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) {
          loadMore();
        }
      },
      { root: null, rootMargin: "240px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, loading, hasMore, entries.length, deferredQuery]);

  return (
    <div className="ledger-page module-page">
      <div className="balance-bar">
        <span>
          คงเหลือ
          {refreshing ? <span className="sync-dot" aria-hidden> ·</span> : null}
        </span>
        <strong>{balance == null ? "…" : `฿${formatPlainNumber(balance)}`}</strong>
      </div>

      <div className="btn-row pnl-toolbar">
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
          placeholder="ค้นหา รายการ / ประเภท / ยอด / วันที่…"
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

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากบันทึกเงินออก</p>
      ) : !loading && deferredQuery && !searchLoading && filteredEntries.length === 0 ? (
        <p className="empty">ไม่พบรายการที่ตรงกับคำค้น</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-in">เข้า</th>
                  <th className="col-out">ออก</th>
                  <th className="col-type">ประเภท</th>
                </tr>
              </thead>
                <tbody>
                  {filteredEntries.map((row) => (
                    <tr key={row.id} className={row.amountIn > 0 ? "row-in" : "row-out"}>
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
                          <button
                            type="button"
                            className={row.receiptUrl ? "photo-status has-photo" : "photo-status"}
                            onClick={() => {
                              if (row.receiptUrl) {
                                setImagePreview({ url: row.receiptUrl, title: row.description });
                                return;
                              }
                              photoEntryRef.current = row;
                              setPhotoUploadRowId(row.id);
                            }}
                            title={row.receiptUrl ? "มีรูป — แตะดูภาพเต็ม" : "เพิ่มรูป"}
                            aria-label={row.receiptUrl ? "ดูรูปเต็ม" : "เพิ่มรูป"}
                          >
                            {row.receiptUrl ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.1a2 2 0 0 0 1.5-.7l2.3-2.3a2 2 0 0 1 1.4-.6H16a2 2 0 0 1 1.4.6l2.3 2.3a2 2 0 0 0 1.5.7H21a2 2 0 0 1 2 2z"/>
                                <circle cx="12" cy="13" r="3"/>
                              </svg>
                            ) : (
                              <span className="photo-status-plus" aria-hidden>+</span>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="col-in">{row.amountIn > 0 ? formatPlainNumber(row.amountIn) : ""}</td>
                      <td className="col-out">{row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}</td>
                      <td className="col-type">
                        <span className="muted" style={{ fontSize: "0.72rem" }}>
                          {row.type ? labelLedgerType(row.type) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          {!deferredQuery ? (
            <>
              <div ref={sentinelRef} className="load-more-sentinel" aria-hidden />
              {loadingMore ? <p className="empty">กำลังโหลดเพิ่ม...</p> : null}
              {!hasMore && entries.length > 0 ? (
                <p className="empty muted-foot">
                  {liveLimit >= LEDGER_LIVE_MAX && entries.length >= LEDGER_LIVE_MAX
                    ? `แสดงล่าสุด ${entries.length} รายการ (อัปเดตอัตโนมัติ)`
                    : `ครบทุกรายการแล้ว (${entries.length})`}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <EditEntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
        />
      ) : null}

      {adding && actorId ? (
        <AddOutModal
          createdBy={actorId}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
        />
      ) : null}

      <input
        ref={photoCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => void handleRowPhotoFile(e.target.files?.[0] || null)}
      />
      <input
        ref={photoGalleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void handleRowPhotoFile(e.target.files?.[0] || null)}
      />

      {imagePreview ? (
        <ImagePreviewModal
          url={imagePreview.url}
          title={imagePreview.title}
          onClose={() => setImagePreview(null)}
        />
      ) : null}

      {photoUploadRowId ? (
        <div
          className="modal-backdrop photo-backdrop"
          onClick={() => { setPhotoUploadRowId(null); photoEntryRef.current = null; }}
        >
          <div className="photo-action-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 700, fontSize: "0.95rem" }}>
              เพิ่มรูป
            </p>
            <div className="receipt-actions">
              <button
                type="button"
                className="primary-btn action-out"
                onClick={() => photoCameraRef.current?.click()}
              >
                ถ่ายภาพ
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => photoGalleryRef.current?.click()}
              >
                แนบรูป
              </button>
            </div>
            <button
              type="button"
              className="ghost-btn"
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={() => { setPhotoUploadRowId(null); photoEntryRef.current = null; }}
            >
              ออก
            </button>
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="บันทึกรายการ"
        formOpen={adding}
        onAdd={() => setAdding(true)}
        addLabel="บันทึกเงินออก"
        variant="glass-out"
      />
    </div>
  );
}

function toDateInput(ms: number) {
  const d = new Date(ms);
  return todayInputValue(d);
}

function AddOutModal({
  createdBy,
  onClose,
  onSaved,
  onError,
}: {
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [typeMode, setTypeMode] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);

  const autoType = useMemo(() => guessTypeFromDescription(description), [description]);
  const resolvedType = typeMode === "auto" ? autoType : typeMode;

  const filteredSuggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
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
      let receiptUrl = "";
      if (receiptFile) receiptUrl = await fileToReceiptDataUrl(receiptFile);
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: 0,
        amountOut: Number(amount),
        type: resolvedType,
        createdBy,
        receiptUrl,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal is-module-form" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="บันทึกเงินออก">
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">บันทึกเงินออก</h2>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {notice ? <p className="muted" style={{ margin: "0 0 0.55rem" }}>{notice}</p> : null}
        <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
          <div className="field">
            <label htmlFor="add-out-date">วันที่</label>
            <input id="add-out-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
                  <button key={item} type="button" className="suggest-chip" onClick={() => setDescription(item)}>
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="add-out-amount">จำนวนเงินออก</label>
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
          <div className="field">
            <span className="field-label">สลิป / รูปถ่าย</span>
            <div className="receipt-actions">
              <button type="button" className="primary-btn" onClick={() => cameraRef.current?.click()}>
                ถ่ายรูป
              </button>
              <button type="button" className="ghost-btn" onClick={() => galleryRef.current?.click()}>
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
              <button
                type="button"
                className="receipt-preview-btn"
                onClick={() => setFullPreviewUrl(receiptPreview)}
                aria-label="ดูรูปเต็ม"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptPreview} alt="ตัวอย่างสลิป" className="receipt-preview" />
              </button>
            ) : null}
          </div>
          <TypePicker
            id="add-out-type"
            value={typeMode}
            onChange={setTypeMode}
            frequent={typeFreq}
            autoHint={autoType}
          />
          <div className="entry-actions">
            <button type="submit" className="primary-btn action-out" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
            <span aria-hidden style={{ width: "2.6rem" }} />
          </div>
        </form>
        {fullPreviewUrl ? (
          <ImagePreviewModal url={fullPreviewUrl} title="สลิป / รูปถ่าย" onClose={() => setFullPreviewUrl(null)} />
        ) : null}
      </div>
    </div>
  );
}

function EditEntryModal({
  entry,
  onClose,
  onSaved,
  onError,
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const isIn = entry.amountIn > 0;
  const [date, setDate] = useState(toDateInput(entry.date));
  const [description, setDescription] = useState(entry.description);
  const [amount, setAmount] = useState(String(isIn ? entry.amountIn : entry.amountOut));
  const [typeMode, setTypeMode] = useState(() => (entry.type || "").trim() || "auto");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);
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
      const value = Number(amount);
      let receiptUrl = entry.receiptUrl || "";
      if (receiptFile) {
        receiptUrl = await fileToReceiptDataUrl(receiptFile);
      }
      await updateLedgerEntry(entry.id, {
        date: parseDateInput(date),
        description,
        amountIn: isIn ? value : 0,
        amountOut: isIn ? 0 : value,
        type: isIn ? entry.type || "โอนเข้า" : resolvedType,
        receiptUrl,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm("ลบรายการนี้?")) return;
    setBusy(true);
    try {
      await deleteLedgerEntry(entry.id);
      onSaved();
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
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
        aria-label="แก้ไขรายการ"
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">แก้ไขรายการ</h2>
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
            <label htmlFor="edit-date">วันที่</label>
            <input
              id="edit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="edit-desc">รายการ</label>
            <input
              id="edit-desc"
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
            <label htmlFor="edit-amount">{isIn ? "เงินเข้า" : "เงินออก"}</label>
            <input
              id="edit-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {!isIn ? (
            <TypePicker
              id="edit-type"
              value={typeMode}
              onChange={setTypeMode}
              frequent={typeFreq}
              autoHint={autoType}
            />
          ) : null}

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
              <button
                type="button"
                className="receipt-preview-btn"
                onClick={() => setFullPreviewUrl(receiptPreview)}
                aria-label="ดูรูปเต็ม"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptPreview} alt="ตัวอย่างสลิป" className="receipt-preview" />
              </button>
            ) : entry.receiptUrl ? (
              <button
                type="button"
                className="receipt-preview-btn"
                onClick={() => setFullPreviewUrl(entry.receiptUrl!)}
                aria-label="ดูรูปเต็ม"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={entry.receiptUrl} alt="สลิปเดิม" className="receipt-preview" />
              </button>
            ) : null}
          </div>

          <div className="entry-actions">
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
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
          </div>
        </form>
        {fullPreviewUrl ? (
          <ImagePreviewModal url={fullPreviewUrl} title="สลิป / รูปถ่าย" onClose={() => setFullPreviewUrl(null)} />
        ) : null}
      </div>
    </div>
  );
}
