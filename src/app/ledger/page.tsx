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
  getLedgerReceiptUrls,
  LEDGER_LIVE_MAX,
  LEDGER_PAGE_SIZE,
  LEDGER_RECEIPT_MAX,
  listLedgerEntries,
  listRecentLedgerEntries,
  recomputeLedgerBalance,
  subscribeLedgerBalance,
  subscribeLedgerPage,
  updateLedgerEntry,
} from "@/lib/ledger";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { PhotoUploadProgressModal } from "@/components/PhotoUploadProgressModal";
import { LedgerAiSettingsPanel } from "@/components/LedgerAiSettingsPanel";
import { LedgerTypeField } from "@/components/LedgerTypeField";
import { frequentTypes, labelLedgerType } from "@/lib/ledger-labels";
import { useLedgerAiClassify } from "@/hooks/use-ledger-ai-classify";
import type { LedgerTypeSource } from "@/lib/ledger-ai";
import { loadCachedLedger, saveCachedLedger } from "@/lib/cache";
import { saveImageToDevice } from "@/lib/receipts";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
} from "@/lib/photo-upload";
import type { LedgerEntry } from "@/lib/types";
import { filterLedgerRows } from "@/lib/smart-search";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { Camera, Trash2, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export default function LedgerPage() {
  return (
    <AuthGate>
      <LedgerView />
    </AuthGate>
  );
}

function LedgerView() {
  const { actorId, staff } = useAuth();
  const isOwner = staff?.role === "owner";
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
  const [rowUploadProgress, setRowUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const [imagePreview, setImagePreview] = useState<{ urls: string[]; title: string } | null>(null);
  const [query, setQuery] = useState("");
  const [searchPool, setSearchPool] = useState<LedgerEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const photoEntryRef = useRef<LedgerEntry | null>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoGalleryRef = useRef<HTMLInputElement>(null);
  const rowUploadCancelRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const balanceRef = useRef<number | null>(null);
  const hasRowsRef = useRef(false);
  const deferredQuery = useDeferredValue(query.trim());

  useBodyScrollLock(
    !!adding || !!editing || !!photoUploadRowId || !!imagePreview || !!rowUploadProgress,
  );

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

  async function handleRowPhotoFiles(fileList: FileList | File[] | null) {
    const files = fileList ? [...fileList].filter(Boolean) : [];
    if (!files.length || !photoEntryRef.current) return;
    const row = photoEntryRef.current;
    const existing = getLedgerReceiptUrls(row);
    const room = LEDGER_RECEIPT_MAX - existing.length;
    if (room <= 0) {
      setError(`แนบได้สูงสุด ${LEDGER_RECEIPT_MAX} รูป — เปิดแก้ไขเพื่อลบรูปเก่า`);
      setPhotoUploadRowId(null);
      photoEntryRef.current = null;
      return;
    }
    const batch = files.slice(0, room);
    if (files.length > room) {
      setError(`แนบได้สูงสุด ${LEDGER_RECEIPT_MAX} รูป — รับเฉพาะ ${room} รูปแรก`);
    } else {
      setError(null);
    }
    setPhotoUploadRowId(null);
    rowUploadCancelRef.current = false;
    try {
      const urls = await uploadEvidencePhotos(batch, {
        folder: "ledger-receipts",
        slotKey: `row-${row.id}`,
        cancelRef: rowUploadCancelRef,
        onProgress: setRowUploadProgress,
      });
      if (!urls.length) throw new Error("อัปโหลดรูปไม่สำเร็จ");
      await updateLedgerEntry(row.id, { receiptUrls: [...existing, ...urls] });
      await Promise.allSettled(batch.map((f) => saveImageToDevice(f)));
    } catch (err) {
      if (!rowUploadCancelRef.current) {
        setError((err as Error).message || "ใช้รูปไม่สำเร็จ");
      }
    } finally {
      setRowUploadProgress(null);
      photoEntryRef.current = null;
      if (photoCameraRef.current) photoCameraRef.current.value = "";
      if (photoGalleryRef.current) photoGalleryRef.current.value = "";
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

      {isOwner && actorId ? <LedgerAiSettingsPanel actorId={actorId} /> : null}

      <aside className="ledger-photo-tip" role="note" aria-label="คำแนะนำถ่ายหลักฐาน">
        <Camera size={18} aria-hidden className="ledger-photo-tip-icon" />
        <div className="ledger-photo-tip-body">
          <p className="ledger-photo-tip-title">ถ่ายหลักฐานให้คมชัด</p>
          <p className="ledger-photo-tip-text">
            โดยเฉพาะใบเสร็จ / เอกสารซื้อ — ตัวหนังสืออ่านได้ แสงพอ ไม่เบลอ
            รูปไม่ชัดอาจตรวจบัญชีไม่ได้
          </p>
        </div>
      </aside>

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
                          {getLedgerReceiptUrls(row).length ? (
                            <EntryPhotoIndicator
                              imageUrls={getLedgerReceiptUrls(row)}
                              label={row.description}
                              onView={(urls) =>
                                setImagePreview({ urls, title: row.description })
                              }
                            />
                          ) : (
                            <button
                              type="button"
                              className="photo-status"
                              onClick={() => {
                                photoEntryRef.current = row;
                                setPhotoUploadRowId(row.id);
                              }}
                              title="เพิ่มรูป"
                              aria-label="เพิ่มรูป"
                            >
                              <span className="photo-status-plus" aria-hidden>+</span>
                            </button>
                          )}
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
          isOwner={isOwner}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
        />
      ) : null}

      {adding && actorId ? (
        <AddOutModal
          createdBy={actorId}
          isOwner={isOwner}
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
        onChange={(e) => {
          void handleRowPhotoFiles(e.target.files);
        }}
      />
      <input
        ref={photoGalleryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          void handleRowPhotoFiles(e.target.files);
        }}
      />

      {imagePreview ? (
        <ImagePreviewModal
          urls={imagePreview.urls}
          title={imagePreview.title}
          onClose={() => setImagePreview(null)}
        />
      ) : null}

      {rowUploadProgress ? (
        <PhotoUploadProgressModal
          progress={rowUploadProgress}
          onCancel={() => {
            rowUploadCancelRef.current = true;
          }}
        />
      ) : null}

      {photoUploadRowId ? (
        <div
          className="modal-backdrop photo-backdrop"
          onClick={() => { setPhotoUploadRowId(null); photoEntryRef.current = null; }}
        >
          <div className="photo-action-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 700, fontSize: "0.95rem" }}>
              เพิ่มรูปหลักฐาน
            </p>
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", textAlign: "left" }}>
              ถ่ายหรือแนบได้หลายรูป · สูงสุด {LEDGER_RECEIPT_MAX} รูปต่อรายการ
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
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [typeMode, setTypeMode] = useState("auto");
  const [ownerLocked, setOwnerLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);

  const ai = useLedgerAiClassify({
    description,
    locked: isOwner && ownerLocked,
  });

  const resolvedType =
    isOwner && ownerLocked && typeMode !== "auto" ? typeMode : ai.type;
  const resolvedSource: LedgerTypeSource =
    isOwner && ownerLocked && typeMode !== "auto" ? "owner" : ai.source;
  const resolvedReason =
    resolvedSource === "owner" ? "" : ai.reason;

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

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      onError("ต้องใส่รายการ");
      return;
    }
    if (ai.status === "loading" && !(isOwner && ownerLocked)) {
      onError("รอ AI จัดประเภทสักครู่");
      return;
    }
    setBusy(true);
    try {
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: 0,
        amountOut: Number(amount),
        type: resolvedType,
        typeSource: resolvedSource,
        typeAiReason: resolvedReason,
        createdBy,
        receiptUrls,
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
          <PhotoAttachMultiField
            label="สลิป / รูปถ่าย"
            values={receiptUrls}
            onChange={setReceiptUrls}
            onError={onError}
            max={LEDGER_RECEIPT_MAX}
            storageFolder="ledger-receipts"
            storageSlotKey={`add-${createdBy || "new"}`}
            hint={`บันทึกหลักฐานเข้าฐานข้อมูล · สูงสุด ${LEDGER_RECEIPT_MAX} รูป`}
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
            id="add-out-type"
            isOwner={isOwner}
            aiType={ai.type}
            aiReason={ai.reason}
            aiSource={ai.source}
            aiStatus={ai.status}
            aiError={ai.error}
            ownerLocked={ownerLocked}
            typeMode={typeMode}
            frequent={typeFreq}
            onTypeModeChange={(value) => {
              setTypeMode(value);
              setOwnerLocked(value !== "auto");
            }}
            onResetToAi={() => {
              setOwnerLocked(false);
              setTypeMode("auto");
              ai.refresh();
            }}
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
        {previewUrls ? (
          <ImagePreviewModal urls={previewUrls} title="สลิป / รูปถ่าย" onClose={() => setPreviewUrls(null)} />
        ) : null}
      </div>
    </div>
  );
}

function EditEntryModal({
  entry,
  isOwner,
  onClose,
  onSaved,
  onError,
}: {
  entry: LedgerEntry;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const isIn = entry.amountIn > 0;
  const initialSource = (entry.typeSource || "").trim() as LedgerTypeSource | "";
  const wasOwnerType = initialSource === "owner";
  const [date, setDate] = useState(toDateInput(entry.date));
  const [description, setDescription] = useState(entry.description);
  const [amount, setAmount] = useState(String(isIn ? entry.amountIn : entry.amountOut));
  const [typeMode, setTypeMode] = useState(() =>
    wasOwnerType ? (entry.type || "").trim() || "auto" : "auto",
  );
  const [ownerLocked, setOwnerLocked] = useState(wasOwnerType);
  const [descTouched, setDescTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptUrls, setReceiptUrls] = useState<string[]>(() => getLedgerReceiptUrls(entry));
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);

  const ai = useLedgerAiClassify({
    description,
    locked: isIn || (isOwner && ownerLocked) || !descTouched,
    enabled: !isIn,
    initial:
      !isIn && entry.type
        ? {
            type: entry.type,
            reason: entry.typeAiReason || "",
            source: (initialSource as LedgerTypeSource) || "ai",
          }
        : undefined,
  });

  const resolvedType =
    isOwner && ownerLocked && typeMode !== "auto" ? typeMode : ai.type;
  const resolvedSource: LedgerTypeSource =
    isOwner && ownerLocked && typeMode !== "auto" ? "owner" : ai.source;
  const resolvedReason =
    resolvedSource === "owner" ? "" : ai.reason;

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

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!isIn && ai.status === "loading" && !(isOwner && ownerLocked)) {
      onError("รอ AI จัดประเภทสักครู่");
      return;
    }
    setBusy(true);
    try {
      const value = Number(amount);
      await updateLedgerEntry(entry.id, {
        date: parseDateInput(date),
        description,
        amountIn: isIn ? value : 0,
        amountOut: isIn ? 0 : value,
        type: isIn ? entry.type || "โอนเข้า" : resolvedType,
        typeSource: isIn ? entry.typeSource || "" : resolvedSource,
        typeAiReason: isIn ? entry.typeAiReason || "" : resolvedReason,
        receiptUrls,
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
              onChange={(e) => {
                setDescription(e.target.value);
                setDescTouched(true);
                // พนักงานแก้ชื่อ → AI จัดใหม่เสมอ · เจ้าของที่ล็อกประเภทไว้คงค่าเดิม
                if (!isOwner || !ownerLocked) {
                  setOwnerLocked(false);
                  setTypeMode("auto");
                }
              }}
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
                    onClick={() => {
                      setDescription(item);
                      setDescTouched(true);
                      if (!isOwner || !ownerLocked) {
                        setOwnerLocked(false);
                        setTypeMode("auto");
                      }
                    }}
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
            <LedgerTypeField
              id="edit-type"
              isOwner={isOwner}
              aiType={ai.type}
              aiReason={ai.reason}
              aiSource={ai.source}
              aiStatus={ai.status}
              aiError={ai.error}
              ownerLocked={ownerLocked}
              typeMode={typeMode}
              frequent={typeFreq}
              onTypeModeChange={(value) => {
                setTypeMode(value);
                setOwnerLocked(value !== "auto");
              }}
              onResetToAi={() => {
                setOwnerLocked(false);
                setTypeMode("auto");
                setDescTouched(true);
                ai.refresh();
              }}
            />
          ) : null}

          <PhotoAttachMultiField
            label="สลิป / รูปถ่าย"
            values={receiptUrls}
            onChange={setReceiptUrls}
            onError={onError}
            max={LEDGER_RECEIPT_MAX}
            storageFolder="ledger-receipts"
            storageSlotKey={`edit-${entry.id}`}
            hint={`บันทึกหลักฐานเข้าฐานข้อมูล · สูงสุด ${LEDGER_RECEIPT_MAX} รูป`}
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
        {previewUrls ? (
          <ImagePreviewModal urls={previewUrls} title="สลิป / รูปถ่าย" onClose={() => setPreviewUrls(null)} />
        ) : null}
      </div>
    </div>
  );
}
