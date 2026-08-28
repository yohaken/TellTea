"use client";

import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { staffHomeHref } from "@/lib/nav-menu";
import {
  addLedgerEntry,
  deleteLedgerEntry,
  frequentDescriptions,
  getLedgerReceiptUrls,
  LEDGER_LIVE_MAX,
  LEDGER_PAGE_SIZE,
  LEDGER_RECEIPT_MAX,
  listLedgerEntriesSince,
  listRecentLedgerEntries,
  recomputeLedgerBalance,
  subscribeLedgerBalance,
  subscribeLedgerPage,
  updateLedgerEntry,
} from "@/lib/ledger";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { TransferInModal } from "@/components/TransferInModal";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { PhotoUploadProgressModal } from "@/components/PhotoUploadProgressModal";
import { CashInLedgerPanel } from "@/components/CashInLedgerPanel";
import { BillNoticeLedgerPanel } from "@/components/BillNoticeLedgerPanel";
import { LedgerAiSettingsPanel } from "@/components/LedgerAiSettingsPanel";
import { EntryVatFieldset } from "@/components/EntryVatFieldset";
import { LedgerAddOutModal } from "@/components/LedgerAddOutModal";
import { LedgerTypeField } from "@/components/LedgerTypeField";
import { personalProfileLabel } from "@/lib/profile";
import { AiSaveProgressModal, type AiSaveStage } from "@/components/AiSaveProgressModal";
import {
  frequentTypes,
  isLedgerAssetType,
  labelLedgerType,
} from "@/lib/ledger-labels";
import {
  classifyLedgerTypeHeuristic,
  classifyLedgerTypeWithAi,
  resolveStoredTypeSource,
  type LedgerTypeSource,
} from "@/lib/ledger-ai";
import { loadCachedLedger, saveCachedLedger } from "@/lib/cache";
import { loadStaffLedgerFromServer } from "@/lib/ledger-staff-load";
import {
  normalizeVatSource,
  parseVatInputStr,
  type VatSource,
} from "@/lib/entry-vat";
import {
  EXTRACT_RECEIPT_MAX,
  extractOwnerBookFromReceipt,
} from "@/lib/owner-books-ai";
import { friendlyFirestoreWriteError, saveImageToDevice } from "@/lib/receipts";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
} from "@/lib/photo-upload";
import type { LedgerEntry } from "@/lib/types";
import { daysAgoMs } from "@/lib/query-window";
import { filterLedgerRows, sortByDateNewestFirst } from "@/lib/smart-search";
import { SheetDateCell } from "@/components/SheetDateCell";
import {
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { formatVatMoney } from "@/lib/vat-number-format";
import { ArrowDownLeft, Trash2, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export default function LedgerPage() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <div className="center-screen">
            <p className="muted">กำลังโหลดบัญชี...</p>
          </div>
        }
      >
        <LedgerView />
      </Suspense>
    </AuthGate>
  );
}

function LedgerView() {
  const { actorId, staff, isPermPreview } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOwner = staff?.role === "owner";
  const canUseLedger = can(staff, "ledger");
  const canTransferIn = can(staff, "transferIn") && !isPermPreview;
  /** พนักงานแก้/เพิ่มรูปได้เฉพาะรายการออกที่ตัวเองสร้าง · พรีวิว = ดูอย่างเดียว */
  function canMutateLedgerRow(row: { createdBy?: string; amountIn?: number }) {
    if (isPermPreview) return false;
    if (isOwner) return true;
    if (!actorId) return false;
    return row.createdBy === actorId && !(Number(row.amountIn) > 0);
  }

  useEffect(() => {
    if (staff && !canUseLedger) router.replace(staffHomeHref(staff));
  }, [staff, canUseLedger, router]);
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
  const [transferInOpen, setTransferInOpen] = useState(false);
  const [photoUploadRowId, setPhotoUploadRowId] = useState<string | null>(null);
  const [rowUploadProgress, setRowUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    urls: string[];
    title: string;
    entryDateMs?: number;
  } | null>(null);
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
    !!adding ||
      !!transferInOpen ||
      !!editing ||
      !!photoUploadRowId ||
      !!imagePreview ||
      !!rowUploadProgress,
  );

  const [cashInForceOpen, setCashInForceOpen] = useState(false);
  const [billNoticeForceOpen, setBillNoticeForceOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("cashIn") === "1") {
      setCashInForceOpen(true);
      router.replace("/ledger/", { scroll: false });
      return;
    }
    if (searchParams.get("billNotice") === "1") {
      setBillNoticeForceOpen(true);
      router.replace("/ledger/", { scroll: false });
      return;
    }
    if (!canTransferIn) return;
    if (searchParams.get("transferIn") === "1") {
      setTransferInOpen(true);
      setAdding(false);
      router.replace("/ledger/", { scroll: false });
    }
  }, [canTransferIn, searchParams, router]);

  useLayoutEffect(() => {
    const cached = loadCachedLedger();
    if (cached?.entries.length) {
      setEntries(sortByDateNewestFirst(cached.entries));
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
    if (!canUseLedger) return;
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

    // Owner-only recompute — staff cannot write meta/ledger under live rules.
    if (isOwner) {
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
    }

    return unsub;
  }, [canUseLedger, isOwner]);

  useEffect(() => {
    if (!canUseLedger) return;
    setError(null);
    if (hasRowsRef.current) setRefreshing(true);
    else setLoading(true);

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const applyBundle = (
      entriesRaw: LedgerEntry[],
      bundleHasMore: boolean,
      bundleBalance: number | null,
    ) => {
      const next = sortByDateNewestFirst(entriesRaw);
      setEntries(next);
      setHasMore(bundleHasMore && liveLimit < LEDGER_LIVE_MAX);
      hasRowsRef.current = next.length > 0;
      if (bundleBalance != null) {
        setBalance(bundleBalance);
        balanceRef.current = bundleBalance;
      }
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      persistSnapshot(next, bundleHasMore, balanceRef.current);
    };

    const loadViaCallable = async () => {
      const result = await loadStaffLedgerFromServer({
        limit: liveLimit,
        staffRole: staff?.role ?? null,
      });
      if (cancelled) return;
      if ("error" in result) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        if (!hasRowsRef.current) setError(result.error);
        return;
      }
      applyBundle(
        result.bundle.entries,
        result.bundle.hasMore,
        result.bundle.balance,
      );
    };

    if (!isOwner) {
      void loadViaCallable();
      pollTimer = setInterval(() => {
        void loadViaCallable();
      }, 60_000);
      return () => {
        cancelled = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    const unsub = subscribeLedgerPage(
      liveLimit,
      (page) => {
        applyBundle(page.entries, page.hasMore, balanceRef.current);
      },
      (err) => {
        const msg = err.message || "โหลดบัญชีไม่สำเร็จ";
        const permDenied = /insufficient permissions/i.test(msg);
        if (permDenied) {
          void loadViaCallable();
          return;
        }
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        if (!hasRowsRef.current) setError(msg);
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [canUseLedger, isOwner, liveLimit, persistSnapshot, staff?.role]);

  useEffect(() => {
    if (!canUseLedger || !deferredQuery) {
      setSearchPool(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void listLedgerEntriesSince(daysAgoMs(180))
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
  }, [canUseLedger, deferredQuery]);

  const filteredEntries = useMemo(() => {
    const source = deferredQuery ? searchPool ?? entries : entries;
    // Live list is already date desc; search pool is asc — always show newest→oldest.
    return sortByDateNewestFirst(filterLedgerRows(source, deferredQuery));
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

  const cashInStaffName =
    personalProfileLabel(staff) || staff?.displayName || staff?.email || "";

  if (!canUseLedger) return null;

  return (
    <div className="ledger-page module-page">
      {actorId ? (
        <div className="ledger-ops-duo" aria-label="เทียบเงินเข้าและแจ้งบิล">
          <CashInLedgerPanel
            actorId={actorId}
            isOwner={!!isOwner}
            staffName={cashInStaffName}
            forceOpen={cashInForceOpen}
            onForceOpenConsumed={() => setCashInForceOpen(false)}
            readOnly={isPermPreview}
          />
          <BillNoticeLedgerPanel
            actorId={actorId}
            isOwner={!!isOwner}
            staffName={cashInStaffName}
            forceOpen={billNoticeForceOpen}
            onForceOpenConsumed={() => setBillNoticeForceOpen(false)}
            readOnly={isPermPreview}
          />
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="ledger-staff-toolbar">
          <div className="table-search ledger-table-search">
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
          <div className="ledger-balance-over-in" aria-label="คงเหลือบัญชีพนักงาน">
            <span>
              คงเหลือ
              {refreshing ? <span className="sync-dot" aria-hidden> ·</span> : null}
            </span>
            <strong>{balance == null ? "…" : `฿${formatPlainNumber(balance)}`}</strong>
          </div>
        </div>
      ) : null}
      {deferredQuery ? (
        <p className="muted table-search-meta ledger-table-search-meta">
          {searchLoading
            ? "กำลังค้นหาทั้งบัญชี…"
            : `พบ ${filteredEntries.length} รายการ`}
        </p>
      ) : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากบันทึกเงินออก</p>
      ) : !loading && deferredQuery && !searchLoading && filteredEntries.length === 0 ? (
        <p className="empty">ไม่พบรายการที่ตรงกับคำค้น</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap ledger-staff-sheet sheet-bleed">
            <table className="sheet-table sheet-table--dense">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-in">เข้า</th>
                  <th className="col-out">ออก</th>
                  <th className="col-vat" title="ภาษีซื้อ">VAT</th>
                  <th className="col-type">ประเภท</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((row) => (
                  <tr
                    key={row.id}
                    className={row.amountIn > 0 ? "row-in" : "row-out"}
                  >
                    <td className="col-date">
                      <SheetDateCell ms={row.date} era="be" />
                    </td>
                    <td className="col-desc">
                      <div className="desc-with-photo">
                        {canMutateLedgerRow(row) ? (
                          <button
                            type="button"
                            className="desc-link"
                            title="แตะเพื่อแก้ไข · ช่อง VAT ในกล่อง"
                            onClick={() => setEditing(row)}
                          >
                            {row.description}
                          </button>
                        ) : (
                          <span className="desc-link desc-link--readonly" title="ดูอย่างเดียว">
                            {row.description}
                          </span>
                        )}
                        {getLedgerReceiptUrls(row).length ? (
                          <EntryPhotoIndicator
                            imageUrls={getLedgerReceiptUrls(row)}
                            label={row.description}
                            onView={(urls) =>
                              setImagePreview({
                                urls,
                                title: row.description,
                                entryDateMs: row.date,
                              })
                            }
                          />
                        ) : canMutateLedgerRow(row) ? (
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
                        ) : null}
                      </div>
                    </td>
                    <td className="col-in">{row.amountIn > 0 ? formatPlainNumber(row.amountIn) : ""}</td>
                    <td className="col-out">{row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}</td>
                    <td className="col-vat">
                      {row.amountOut > 0 && row.hasVat && (row.vatInput || 0) > 0 ? (
                        <span className="owner-vat-badge" title="ภาษีซื้อ">
                          {formatVatMoney(row.vatInput || 0)}
                        </span>
                      ) : (
                        <span className="muted owner-vat-empty">—</span>
                      )}
                    </td>
                    <td
                      className={
                        isLedgerAssetType(row.type)
                          ? "col-type is-asset-type"
                          : "col-type"
                      }
                    >
                      <span className="muted">
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

      {transferInOpen && canTransferIn && actorId ? (
        <TransferInModal
          createdBy={actorId}
          onClose={() => setTransferInOpen(false)}
          onSaved={() => setTransferInOpen(false)}
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
          entryDateMs={imagePreview.entryDateMs}
          showCaptureMeta={isOwner}
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

      {!isPermPreview ? (
        <ModuleTabDock
          ariaLabel="บันทึกรายการ"
          formOpen={adding}
          onAdd={() => {
            setTransferInOpen(false);
            setAdding(true);
          }}
          addLabel="+ ออก"
          variant="glass-out"
        />
      ) : null}

      {canTransferIn ? (
        <button
          type="button"
          className="ledger-transfer-in-fab"
          aria-label="โอนเข้า"
          title="โอนเข้า"
          onClick={() => {
            setAdding(false);
            setTransferInOpen(true);
          }}
        >
          <ArrowDownLeft size={16} aria-hidden />
          <span>เข้า</span>
        </button>
      ) : null}

      {isOwner && actorId ? <LedgerAiSettingsPanel actorId={actorId} /> : null}
    </div>
  );
}

function toDateInput(ms: number) {
  const d = new Date(ms);
  return todayInputValue(d);
}

function AddOutModal(props: {
  createdBy: string;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  return <LedgerAddOutModal {...props} />;
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
  const initialSource = resolveStoredTypeSource(entry.typeSource);
  const wasOwnerType = initialSource === "owner";
  const [date, setDate] = useState(toDateInput(entry.date));
  const [description, setDescription] = useState(entry.description);
  const [amount, setAmount] = useState(String(isIn ? entry.amountIn : entry.amountOut));
  const [typeMode, setTypeMode] = useState(() =>
    wasOwnerType || initialSource === "legacy"
      ? (entry.type || "").trim() || "auto"
      : "auto",
  );
  const [ownerLocked, setOwnerLocked] = useState(wasOwnerType);
  const [forceReclassify, setForceReclassify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveStage, setSaveStage] = useState<AiSaveStage | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [hasVat, setHasVat] = useState(Boolean(!isIn && entry.hasVat));
  const [vatInputStr, setVatInputStr] = useState(() =>
    !isIn && entry.hasVat && (entry.vatInput || 0) > 0
      ? String(entry.vatInput)
      : "",
  );
  const [vatInvoiceNo, setVatInvoiceNo] = useState(
    !isIn ? entry.vatInvoiceNo || "" : "",
  );
  const [vatSource, setVatSource] = useState<VatSource>(() =>
    !isIn ? normalizeVatSource(entry.vatSource) : "",
  );
  const [vatVerified, setVatVerified] = useState(
    Boolean(!isIn && entry.vatVerified),
  );
  const [vatClaim, setVatClaim] = useState(
    Boolean(!isIn && entry.hasVat && entry.vatClaim),
  );
  const [aiVatReason, setAiVatReason] = useState("");
  const [extractStatus, setExtractStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const lastExtractKeyRef = useRef("");
  const extractBusyRef = useRef(false);
  const descriptionRef = useRef(description);
  const amountRef = useRef(amount);
  descriptionRef.current = description;
  amountRef.current = amount;
  const [receiptUrls, setReceiptUrls] = useState<string[]>(() => getLedgerReceiptUrls(entry));
  const [previewType, setPreviewType] = useState(entry.type || "");
  const [previewReason, setPreviewReason] = useState(entry.typeAiReason || "");
  const [previewSource, setPreviewSource] = useState<LedgerTypeSource>(initialSource);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">("ready");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const descChanged = description.trim() !== (entry.description || "").trim();
  const shouldClassifyOnSave =
    !isIn &&
    !(isOwner && ownerLocked && typeMode !== "auto") &&
    (forceReclassify || descChanged || !entry.typeSource || initialSource === "legacy");

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

  async function runExtractFromPhotos(urls: string[]) {
    if (isIn) return;
    const refs = urls
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, EXTRACT_RECEIPT_MAX);
    if (!refs.length) return;
    const key = refs.join("|");
    if (key === lastExtractKeyRef.current || extractBusyRef.current) return;
    extractBusyRef.current = true;
    setExtractStatus("loading");
    try {
      const result = await extractOwnerBookFromReceipt(refs);
      lastExtractKeyRef.current = key;
      // Keep the saved accounting date — AI must not change it on re-read.
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

  async function runOwnerPreview() {
    const text = description.trim();
    if (!text) {
      onError("ใส่ชื่อรายการก่อนจัดประเภท");
      return;
    }
    setOwnerLocked(false);
    setTypeMode("auto");
    setForceReclassify(true);
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
    try {
      const value = Number(amount);
      let type = isIn ? entry.type || "โอนเข้า" : previewType || entry.type || "cogs";
      let typeSource = isIn ? entry.typeSource || "" : previewSource;
      let typeAiReason = isIn ? entry.typeAiReason || "" : previewReason;

      if (!isIn) {
        if (isOwner && ownerLocked && typeMode !== "auto") {
          type = typeMode;
          typeSource = "owner";
          typeAiReason = "";
        } else if (shouldClassifyOnSave) {
          setSaveStage("sending");
          // yield so UI paints "sending" before classify
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
      }

      const vatInputNum = parseVatInputStr(vatInputStr);
      if (!isIn && hasVat && vatInputNum <= 0) {
        throw new Error("มี VAT — ใส่ยอดภาษีซื้อจากบิล หรือกดใช้ประมาณ ×7/107");
      }
      await updateLedgerEntry(entry.id, {
        date: parseDateInput(date),
        description,
        amountIn: isIn ? value : 0,
        amountOut: isIn ? 0 : value,
        type,
        typeSource,
        typeAiReason,
        receiptUrls,
        ...(isIn
          ? {
              hasVat: false,
              vatInput: 0,
              vatInvoiceNo: "",
              vatSource: "",
              vatVerified: false,
              vatClaim: false,
            }
          : {
              hasVat,
              vatInput: hasVat ? vatInputNum : 0,
              vatInvoiceNo: hasVat ? vatInvoiceNo.trim() : "",
              vatSource: hasVat ? vatSource || "manual" : "",
              vatVerified: hasVat ? vatVerified : false,
              vatClaim: hasVat && vatInputNum > 0 ? vatClaim : false,
            }),
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
      setSaveStage(null);
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
    <div
      className="modal-backdrop edit-modal is-module-form is-compact-form"
      role="presentation"
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="แก้ไขรายการ"
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">แก้ไขรายการ</h2>
          <div className="entry-toolbar-actions">
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
        <EntryTimestampsMeta
          entryDate={entry.date}
          createdAt={entry.createdAt}
          updatedAt={entry.updatedAt}
          era="be"
        />
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
                if (!isOwner || !ownerLocked) {
                  setOwnerLocked(false);
                  setTypeMode("auto");
                  setForceReclassify(true);
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
                      if (!isOwner || !ownerLocked) {
                        setOwnerLocked(false);
                        setTypeMode("auto");
                        setForceReclassify(true);
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
              storageSlotKey={`edit-${entry.id}`}
              hint="ถ่าย/แนบ — AI อ่าน VAT"
            />
          ) : (
            <PhotoAttachMultiField
              label="รูป"
              values={receiptUrls}
              onChange={setReceiptUrls}
              onError={onError}
              max={LEDGER_RECEIPT_MAX}
              storageFolder="ledger-receipts"
              storageSlotKey={`edit-${entry.id}`}
              hint=""
            />
          )}

          {!isIn ? (
            <EntryVatFieldset
              idPrefix="edit-ledger"
              disabled={busy}
              amountInclusive={Number(amount) || 0}
              hasVat={hasVat}
              vatInputStr={vatInputStr}
              vatInvoiceNo={vatInvoiceNo}
              vatSource={vatSource}
              vatVerified={vatVerified}
              vatClaim={vatClaim}
              onVatClaimChange={setVatClaim}
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
              canRereadAi={receiptUrls.length > 0}
              onRereadAi={() => {
                lastExtractKeyRef.current = "";
                void runExtractFromPhotos(receiptUrls);
              }}
            />
          ) : null}

          {!isIn ? (
            <>
              <LedgerTypeField
                id="edit-type"
                isOwner={isOwner}
                mode={isOwner ? "live" : "deferred"}
                displayType={previewType || entry.type}
                aiType={previewType || entry.type || "cogs"}
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
              {!isOwner ? (
                <label
                  className="ledger-ai-use-images"
                  title={
                    descChanged
                      ? "เปิดอัตโนมัติเพราะแก้ชื่อรายการ"
                      : "จัดประเภทใหม่ด้วย AI เมื่อบันทึก"
                  }
                >
                  <input
                    type="checkbox"
                    checked={forceReclassify || descChanged}
                    onChange={(e) => setForceReclassify(e.target.checked)}
                    disabled={busy || descChanged}
                  />
                  <span>
                    จัดประเภทใหม่ตอนบันทึก
                    {descChanged ? (
                      <span className="ledger-ai-use-images-hint"> · เปิดอัตโนมัติ</span>
                    ) : null}
                  </span>
                </label>
              ) : null}
            </>
          ) : null}

          <div className="entry-actions">
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
          </div>
        </form>
      </div>
      {saveStage ? (
        <AiSaveProgressModal stage={saveStage} detail={description.trim()} />
      ) : null}
    </div>
  );
}
