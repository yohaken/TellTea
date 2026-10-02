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
  bulkUpdateLedgerTypes,
  deleteLedgerEntry,
  frequentDescriptions,
  getLedgerReceiptUrls,
  LEDGER_LIVE_MAX,
  LEDGER_OUT_TYPES,
  LEDGER_PAGE_SIZE,
  LEDGER_RECEIPT_MAX,
  listLedgerEntriesSince,
  listRecentLedgerEntries,
  loadLedgerRange,
  recomputeLedgerBalance,
  subscribeLedgerBalance,
  subscribeLedgerPage,
  updateLedgerEntry,
} from "@/lib/ledger";
import { appendLedgerAudit } from "@/lib/ledger-audit";
import { getFiledMonths, ledgerMonthKey } from "@/lib/ledger-closed-months";
import { formatThaiMonthKey } from "@/lib/vat-monthly";
import {
  LedgerAiProgressLine,
  LedgerClosedMonthDialog,
  LedgerRangePicker,
  LedgerStatusBadge,
  ledgerStatusOf,
  type ClosedMonthConfirm,
  type LedgerRange,
} from "@/components/LedgerOrganizeTools";
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
import { LedgerBillLinesPanel } from "@/components/LedgerBillLinesPanel";
import { LedgerTypeField } from "@/components/LedgerTypeField";
import {
  extractBillLinesFromPhotos,
  normalizeLedgerBillLines,
  syncCogsBillLinesIntoStock,
} from "@/lib/ledger-bill-lines";
import {
  subscribeStockItems,
  subscribeStockItemsWithCosts,
} from "@/lib/stock";
import type { LedgerBillLine, LedgerEntry, StockItem } from "@/lib/types";
import { personalProfileLabel } from "@/lib/profile";
import { AiSaveProgressModal, type AiSaveStage } from "@/components/AiSaveProgressModal";
import {
  isLedgerAssetType,
  labelLedgerType,
  ledgerTypeColorKey,
} from "@/lib/ledger-labels";
import {
  billTypeHintFromExtract,
  classifyLedgerTypeHeuristic,
  classifyLedgerTypeWithAi,
  usableBillTypeHint,
  type BillTypeHint,
  normalizeLedgerOutType,
  reclassifyLedgerRowsWithAi,
  resolveStoredTypeSource,
  type LedgerTypeSource,
  type ReclassifyMonthProgress,
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
import { daysAgoMs } from "@/lib/query-window";
import { filterLedgerRowsMulti, sortByDateNewestFirst } from "@/lib/smart-search";
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
  /** หลายช่องค้น — ต้องตรงทุกช่อง */
  const [queries, setQueries] = useState<string[]>([""]);
  const [searchPool, setSearchPool] = useState<LedgerEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  /** เครื่องมือจัดระเบียบประเภท — เจ้าของเท่านั้น (พรีวิวสิทธิ์ = ปิด) */
  const canOrganize = isOwner && !isPermPreview;
  const [range, setRange] = useState<LedgerRange | null>(null);
  const [rangeRows, setRangeRows] = useState<LedgerEntry[] | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState<ReclassifyMonthProgress | null>(null);
  const aiCancelRef = useRef(false);
  const [closedConfirm, setClosedConfirm] = useState<
    (ClosedMonthConfirm & { resolve: (ok: boolean) => void }) | null
  >(null);
  const photoEntryRef = useRef<LedgerEntry | null>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoGalleryRef = useRef<HTMLInputElement>(null);
  const rowUploadCancelRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const balanceRef = useRef<number | null>(null);
  const hasRowsRef = useRef(false);
  const deferredQuery = useDeferredValue(
    queries
      .map((q) => q.trim())
      .filter(Boolean)
      .join("\n"),
  );

  useBodyScrollLock(
    !!adding ||
      !!transferInOpen ||
      !!editing ||
      !!photoUploadRowId ||
      !!imagePreview ||
      !!rowUploadProgress ||
      !!closedConfirm,
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
      // Slim rules: staff uses live snapshot like owner; callable only on deny.
      const unsubStaff = subscribeLedgerPage(
        liveLimit,
        (page) => {
          applyBundle(page.entries, page.hasMore, balanceRef.current);
        },
        (err) => {
          const msg = err.message || "โหลดบัญชีไม่สำเร็จ";
          if (/insufficient permissions/i.test(msg)) {
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
        unsubStaff();
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
    if (!canUseLedger || !deferredQuery || range) {
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
  }, [canUseLedger, deferredQuery, range]);

  const filteredEntries = useMemo(() => {
    const source = range
      ? rangeRows ?? []
      : deferredQuery
        ? searchPool ?? entries
        : entries;
    // Live list is already date desc; search pool is asc — always show newest→oldest.
    return sortByDateNewestFirst(
      filterLedgerRowsMulti(source, deferredQuery ? deferredQuery.split("\n") : [], (row) =>
        row.amountOut > 0 ? ledgerStatusOf(row).label : "",
      ),
    );
  }, [entries, searchPool, deferredQuery, range, rangeRows]);

  const selectableRows = useMemo(
    () => (canOrganize ? filteredEntries.filter((r) => r.amountOut > 0) : []),
    [canOrganize, filteredEntries],
  );
  const selectedRows = useMemo(
    () => selectableRows.filter((r) => selectedIds.has(r.id)),
    [selectableRows, selectedIds],
  );
  const allVisibleSelected =
    selectableRows.length > 0 && selectedRows.length === selectableRows.length;
  const someVisibleSelected = selectedRows.length > 0;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(selectableRows.map((r) => r.id)));
  }

  function selectNeedsReview() {
    setSelectedIds(
      new Set(
        selectableRows
          .filter((r) => {
            const key = ledgerStatusOf(r).key;
            return (
              (key === "guess" || key === "blank") &&
              !String(r.typeSource || "").startsWith("payroll")
            );
          })
          .map((r) => r.id),
      ),
    );
  }

  async function applyRange(next: LedgerRange) {
    setRangeLoading(true);
    setError(null);
    setBulkMsg(null);
    try {
      const rows = await loadLedgerRange(next.from, next.to);
      setRange(next);
      setRangeRows(rows);
      setSelectedIds(new Set());
    } catch (err) {
      setError((err as Error).message || "โหลดช่วงวันที่ไม่สำเร็จ");
    } finally {
      setRangeLoading(false);
    }
  }

  function clearRange() {
    setRange(null);
    setRangeRows(null);
    setSelectedIds(new Set());
    setBulkMsg(null);
  }

  /** อัปเดตเซลล์ทันทีทุกมุมมอง (สด · ค้นหา · ช่วงวันที่) ไม่รอ snapshot/โหลดใหม่ */
  function patchRowsLocal(patches: Map<string, Partial<LedgerEntry>>) {
    if (!patches.size) return;
    const apply = (list: LedgerEntry[] | null) =>
      list
        ? list.map((r) => {
            const p = patches.get(r.id);
            return p ? { ...r, ...p } : r;
          })
        : list;
    setEntries((prev) => apply(prev) ?? prev);
    setSearchPool((prev) => apply(prev));
    setRangeRows((prev) => apply(prev));
  }

  /** ช่วงวันที่เป็นการอ่านครั้งเดียว — โหลดใหม่หลังแก้ */
  async function refreshRange() {
    if (!range) return;
    try {
      setRangeRows(await loadLedgerRange(range.from, range.to));
    } catch {
      /* แสดงข้อมูลเดิมต่อ */
    }
  }

  /** ถามก่อนทุกครั้งถ้ามีแถวในงวด VAT ที่ยื่นแล้ว · คืนรายชื่อเดือนที่ปิด */
  async function confirmClosedMonths(
    rows: LedgerEntry[],
    actionLabel: string,
    nextType?: string,
  ): Promise<{ ok: boolean; closed: string[] }> {
    const byMonth = new Map<string, { count: number; amount: number; types: string[] }>();
    for (const r of rows) {
      const key = ledgerMonthKey(r.date);
      if (!key) continue;
      const m = byMonth.get(key) || { count: 0, amount: 0, types: [] };
      m.count += 1;
      m.amount += Number(r.amountOut) || 0;
      m.types.push(normalizeLedgerOutType(r.type || ""));
      byMonth.set(key, m);
    }
    const closed = await getFiledMonths([...byMonth.keys()]);
    if (!closed.length) return { ok: true, closed };
    const pnlOutside = (t: string) => t === "asset" || t === "อื่นๆ";
    const closedTypes = closed.flatMap((k) => byMonth.get(k)?.types || []);
    const touchesOther = nextType
      ? closedTypes.some((t) => pnlOutside(t) !== pnlOutside(nextType))
      : true;
    const ok = await new Promise<boolean>((resolve) => {
      setClosedConfirm({
        actionLabel,
        touchesOther,
        months: closed.map((key) => ({
          key,
          count: byMonth.get(key)?.count || 0,
          amount: Math.round((byMonth.get(key)?.amount || 0) * 100) / 100,
        })),
        resolve,
      });
    });
    setClosedConfirm(null);
    return { ok, closed };
  }

  async function onBulkSetType(nextType: string) {
    const rows = selectedRows;
    if (!rows.length || bulkBusy) return;
    setBulkMsg(null);
    setError(null);
    try {
      const { ok, closed } = await confirmClosedMonths(
        rows,
        `ตั้ง ${rows.length} รายการเป็น «${labelLedgerType(nextType)}»`,
        nextType,
      );
      if (!ok) return;
      setBulkBusy(true);
      const count = await bulkUpdateLedgerTypes(
        rows.map((r) => r.id),
        nextType,
        { source: "owner" },
      );
      patchRowsLocal(
        new Map(
          rows.map((r) => [r.id, { type: nextType, typeSource: "owner", typeAiReason: "" }]),
        ),
      );
      await appendLedgerAudit({
        action: "bulk_set_type",
        actor: actorId || "",
        closedMonthOverride: closed.length > 0,
        closedMonths: closed,
        summary: `ตั้ง ${count} รายการเป็น ${nextType}`,
        items: rows.map((r) => ({
          id: r.id,
          monthKey: ledgerMonthKey(r.date),
          beforeType: r.type || "",
          beforeSource: String(r.typeSource || ""),
          afterType: nextType,
          afterSource: "owner",
        })),
      });
      setBulkMsg(`ตั้งเป็น «${labelLedgerType(nextType)}» แล้ว ${count} รายการ`);
      setSelectedIds(new Set());
      await refreshRange();
    } catch (err) {
      setError((err as Error).message || "ตั้งประเภทไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
    }
  }

  async function onBulkAi() {
    if (!selectedRows.length || bulkBusy) return;
    const rows = selectedRows.filter(
      (r) =>
        ledgerStatusOf(r).key !== "owner" && !String(r.typeSource || "").startsWith("payroll"),
    );
    setBulkMsg(null);
    setError(null);
    if (!rows.length) {
      setBulkMsg("แถวที่เลือกเป็น «จัดเอง» ทั้งหมด — AI ไม่ทับ");
      return;
    }
    try {
      const { ok, closed } = await confirmClosedMonths(rows, `ให้ AI จัด ${rows.length} รายการ`);
      if (!ok) return;
      setBulkBusy(true);
      aiCancelRef.current = false;
      const { progress, changes } = await reclassifyLedgerRowsWithAi(rows, {
        onProgress: setAiProgress,
        onRowChanged: (c) =>
          patchRowsLocal(
            new Map([[c.id, { type: c.afterType, typeSource: "ai", typeAiReason: c.reason }]]),
          ),
        shouldCancel: () => aiCancelRef.current,
      });
      await appendLedgerAudit({
        action: "ai_reclassify",
        actor: actorId || "",
        closedMonthOverride: closed.length > 0,
        closedMonths: closed,
        summary: `AI จัด ${changes.length} รายการ`,
        items: changes.map((c) => ({
          id: c.id,
          monthKey: ledgerMonthKey(c.date),
          beforeType: c.beforeType,
          beforeSource: c.beforeSource,
          afterType: c.afterType,
          afterSource: "ai",
        })),
      });
      if (progress.failed) setError(`AI จัดไม่สำเร็จ ${progress.failed} รายการ`);
      setSelectedIds(new Set());
      await refreshRange();
    } catch (err) {
      setError((err as Error).message || "AI จัดประเภทไม่สำเร็จ");
    } finally {
      setAiProgress(null);
      setBulkBusy(false);
    }
  }

  const loadMore = useCallback(() => {
    if (deferredQuery || range) return;
    if (!hasMore || loadingMore || liveLimit >= LEDGER_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + LEDGER_PAGE_SIZE, LEDGER_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit, deferredQuery, range]);

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
          <div className="ledger-search-stack">
            {queries.map((q, i) => (
              <div key={i} className="table-search ledger-table-search">
                <input
                  type="search"
                  value={q}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQueries((prev) => prev.map((p, j) => (j === i ? v : p)));
                  }}
                  placeholder={i === 0 ? "ค้นหา… (ชื่อ · ยอด · /10/ · 5/10)" : "และ…"}
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-label={`ค้นหาในตาราง ช่อง ${i + 1}`}
                />
                {q.trim() || i > 0 ? (
                  <button
                    type="button"
                    className="ghost-btn table-search-clear"
                    onClick={() =>
                      setQueries((prev) =>
                        i > 0 ? prev.filter((_, j) => j !== i) : prev.map((p, j) => (j === 0 ? "" : p)),
                      )
                    }
                    aria-label={i > 0 ? "ลบช่องค้นหา" : "ล้างคำค้น"}
                  >
                    {i > 0 ? "ลบ" : "ล้าง"}
                  </button>
                ) : null}
                {i === queries.length - 1 && queries.length < 4 ? (
                  <button
                    type="button"
                    className="ghost-btn table-search-add"
                    onClick={() => setQueries((prev) => [...prev, ""])}
                    aria-label="เพิ่มช่องค้นหา"
                    title="เพิ่มช่องค้นหา (ต้องตรงทุกช่อง)"
                  >
                    +
                  </button>
                ) : null}
              </div>
            ))}
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
      {canOrganize && !loading ? (
        <div className="ledger-organize" aria-label="จัดระเบียบประเภท (เจ้าของ)">
          <LedgerRangePicker
            active={range}
            loading={rangeLoading}
            onApply={(r) => void applyRange(r)}
            onClear={clearRange}
          />
          {range ? (
            <p className="muted ledger-range-meta">
              ช่วง {range.label} · {rangeRows?.length ?? 0} รายการ (ไม่อัปเดตสด)
            </p>
          ) : null}
          <div
            className="bulk-status-toolbar ledger-bulk-compact"
            role="group"
            aria-label="จัดประเภทหลายรายการ"
          >
            <button
              type="button"
              className="ghost-btn bulk-status-chip"
              disabled={bulkBusy || !selectableRows.length}
              onClick={toggleSelectAllVisible}
            >
              {allVisibleSelected ? "ยกเลิกที่แสดง" : `เลือกที่แสดง (${selectableRows.length})`}
            </button>
            <button
              type="button"
              className="ghost-btn bulk-status-chip"
              disabled={bulkBusy || !selectableRows.length}
              onClick={selectNeedsReview}
              title="เลือกแถวที่ผู้จัดเป็น เดา หรือ ว่าง"
            >
              เลือกเฉพาะ เดา/ว่าง
            </button>
            {someVisibleSelected ? (
              <div className="bulk-status-actions" role="group" aria-label="ตั้งประเภทกลุ่ม">
                <span className="bulk-status-count">เลือก {selectedRows.length} รายการ</span>
                <button
                  type="button"
                  className="ghost-btn bulk-status-btn is-ai"
                  disabled={bulkBusy}
                  onClick={() => void onBulkAi()}
                  title="ข้ามแถวที่จัดเอง"
                >
                  AI จัด
                </button>
                <select
                  className="bulk-status-select"
                  value=""
                  disabled={bulkBusy}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void onBulkSetType(v);
                  }}
                  aria-label="ตั้งเป็นประเภท"
                >
                  <option value="">ตั้งเป็น ▾</option>
                  {LEDGER_OUT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {labelLedgerType(t)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost-btn bulk-status-clear"
                  disabled={bulkBusy}
                  onClick={() => setSelectedIds(new Set())}
                >
                  ล้าง
                </button>
              </div>
            ) : (
              <p className="muted bulk-status-hint">ติ๊กแถวเงินออก แล้วกด AI จัด หรือ ตั้งเป็น</p>
            )}
          </div>
          {aiProgress ? (
            <LedgerAiProgressLine
              progress={aiProgress}
              onCancel={() => {
                aiCancelRef.current = true;
              }}
            />
          ) : null}
          {bulkMsg ? <p className="muted ledger-bulk-msg">{bulkMsg}</p> : null}
        </div>
      ) : null}

      {deferredQuery ? (
        <p className="muted table-search-meta ledger-table-search-meta">
          {searchLoading
            ? "กำลังค้นหาทั้งบัญชี…"
            : `พบ ${filteredEntries.length} รายการ`}
        </p>
      ) : null}

      {!loading && !range && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากบันทึกเงินออก</p>
      ) : !loading && range && !rangeLoading && filteredEntries.length === 0 ? (
        <p className="empty">{deferredQuery ? "ไม่พบรายการที่ตรงกับคำค้น" : "ไม่มีรายการในช่วงนี้"}</p>
      ) : !loading && deferredQuery && !searchLoading && filteredEntries.length === 0 ? (
        <p className="empty">ไม่พบรายการที่ตรงกับคำค้น</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap ledger-staff-sheet sheet-bleed">
            <table className="sheet-table sheet-table--dense">
              <thead>
                <tr>
                  {canOrganize ? (
                    <th className="bulk-check-col" aria-label="เลือก">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                        }}
                        disabled={bulkBusy || !selectableRows.length}
                        onChange={toggleSelectAllVisible}
                        aria-label="เลือกทั้งหมดที่แสดง"
                      />
                    </th>
                  ) : null}
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-in">เข้า</th>
                  <th className="col-out">ออก</th>
                  <th className="col-vat" title="ภาษีซื้อ">VAT</th>
                  <th className="col-type">ประเภท</th>
                  <th className="col-status" title="ผู้จัดประเภท: AI / จัดเอง / เดา / ว่าง">
                    <span className="col-status-head">
                      ผู้จัด
                      {canOrganize ? (
                        <button
                          type="button"
                          className="col-status-ai-btn"
                          disabled={bulkBusy || !someVisibleSelected}
                          onClick={() => void onBulkAi()}
                          title="AI จัดแถวที่ติ๊กไว้ (ข้ามแถวที่จัดเอง)"
                        >
                          AI
                        </button>
                      ) : null}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((row) => (
                  <tr
                    key={row.id}
                    className={[
                      row.amountIn > 0 ? "row-in" : "row-out",
                      selectedIds.has(row.id) ? "is-bulk-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {canOrganize ? (
                      <td className="bulk-check-col">
                        {row.amountOut > 0 ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            disabled={bulkBusy}
                            onChange={() => toggleSelected(row.id)}
                            aria-label={`เลือก ${row.description}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
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
                      className={[
                        "col-type",
                        ledgerTypeColorKey(row.type) ? `is-type-${ledgerTypeColorKey(row.type)}` : "",
                        isLedgerAssetType(row.type) ? "is-asset-type" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="muted">
                        {row.type ? labelLedgerType(row.type) : "—"}
                      </span>
                    </td>
                    <td className="col-status">
                      {row.amountOut > 0 ? <LedgerStatusBadge row={row} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!deferredQuery && !range ? (
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

      {editing && actorId ? (
        <EditEntryModal
          entry={editing}
          isOwner={isOwner}
          actorId={actorId}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            const id = editing.id;
            setEditing(null);
            if (patch) patchRowsLocal(new Map([[id, patch]]));
            void refreshRange();
          }}
          onError={setError}
        />
      ) : null}

      {closedConfirm ? (
        <LedgerClosedMonthDialog
          confirm={closedConfirm}
          onCancel={() => closedConfirm.resolve(false)}
          onConfirm={() => closedConfirm.resolve(true)}
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
  actorId,
  onClose,
  onSaved,
  onError,
}: {
  entry: LedgerEntry;
  isOwner: boolean;
  actorId: string;
  onClose: () => void;
  onSaved: (patch?: Partial<LedgerEntry>) => void;
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
  const ownerLockedRef = useRef(ownerLocked);
  const aiTypeHintRef = useRef<BillTypeHint | null>(null);
  descriptionRef.current = description;
  amountRef.current = amount;
  ownerLockedRef.current = ownerLocked;
  const [receiptUrls, setReceiptUrls] = useState<string[]>(() => getLedgerReceiptUrls(entry));
  const [billLines, setBillLines] = useState<LedgerBillLine[]>(() =>
    normalizeLedgerBillLines(entry.billLines),
  );
  const [stock, setStock] = useState<StockItem[]>([]);
  const [billLinesMsg, setBillLinesMsg] = useState("");
  const billLinesGenRef = useRef(0);
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
      })
      .catch(() => {
        setSuggestions([]);
      });
  }, []);

  useEffect(() => {
    if (isIn) return;
    if (isOwner) {
      return subscribeStockItemsWithCosts(setStock, () => undefined);
    }
    return subscribeStockItems(setStock, () => undefined);
  }, [isIn, isOwner]);

  const stockRef = useRef(stock);
  stockRef.current = stock;

  async function runExtractBillLines(refs: string[]) {
    const gen = ++billLinesGenRef.current;
    try {
      const lines = await extractBillLinesFromPhotos({
        imageRefs: refs,
        stock: stockRef.current,
      });
      if (gen !== billLinesGenRef.current) return;
      if (lines.length) {
        setBillLines(lines);
        setBillLinesMsg(`แยกรายการในบิล ${lines.length} รายการ`);
      }
    } catch {
      /* VAT extract สำคัญกว่า — แยกรายการกดเองได้ · ไม่กระทบ busy ฟอร์ม */
    }
  }

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
      const hint = billTypeHintFromExtract(
        result,
        descriptionRef.current.trim() || result.description,
      );
      aiTypeHintRef.current = hint;
      if (hint && !ownerLockedRef.current) {
        setTypeMode("auto");
        setForceReclassify(true);
        setPreviewType(hint.type);
        setPreviewReason(hint.reason);
        setPreviewSource("ai");
        setPreviewStatus("ready");
        setPreviewError(null);
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
      // แยกรายการวัตถุดิบเก็บในรายละเอียดบิล (ไม่โชว์ลิสต์)
      if (result.goodsOnly !== false && !result.slipOnly) {
        void runExtractBillLines(refs);
      }
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
      aiTypeHintRef.current = { type: result.type, reason: result.reason, description: text };
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
        } else if (shouldClassifyOnSave && usableBillTypeHint(aiTypeHintRef.current, description)) {
          const hint = aiTypeHintRef.current!;
          type = hint.type;
          typeSource = "ai";
          typeAiReason = hint.reason;
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

      const prevType = (entry.type || "").trim();
      const typeChanged = !isIn && type.trim() !== prevType;
      let closedMonths: string[] = [];
      if (typeChanged) {
        closedMonths = await getFiledMonths([ledgerMonthKey(entry.date)]);
        if (
          closedMonths.length &&
          !window.confirm(
            `รายการนี้อยู่ในงบ ${formatThaiMonthKey(closedMonths[0]!)} ที่ยื่น VAT แล้ว\n` +
              `เปลี่ยนประเภท «${prevType ? labelLedgerType(prevType) : "—"}» → «${labelLedgerType(type)}» ` +
              "จะทำให้ยอดต้นทุน/ค่าใช้จ่ายของเดือนนั้นเปลี่ยน (ภาษีซื้อไม่เปลี่ยน)\n\nยืนยันแก้งบที่ปิดแล้ว?",
          )
        ) {
          return;
        }
      }

      let nextBillLines = billLines;
      if (!isIn && billLines.length && actorId) {
        try {
          const synced = await syncCogsBillLinesIntoStock({
            lines: billLines,
            stock,
            ledgerType: type,
            updatedBy: actorId,
          });
          nextBillLines = synced.lines;
          if (synced.importResult?.created.length) {
            setBillLinesMsg(
              `เข้าคลัง (แถบไม่นับ) ใหม่ ${synced.importResult.created.length} รายการ — ดูที่ /stock/`,
            );
          }
        } catch {
          /* สร้างคลังไม่บล็อกบันทึกบัญชี */
        }
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
              billLines: [],
            }
          : {
              hasVat,
              vatInput: hasVat ? vatInputNum : 0,
              vatInvoiceNo: hasVat ? vatInvoiceNo.trim() : "",
              vatSource: hasVat ? vatSource || "manual" : "",
              vatVerified: hasVat ? vatVerified : false,
              vatClaim: hasVat && vatInputNum > 0 ? vatClaim : false,
              billLines: nextBillLines,
            }),
      });
      if (!isIn) setBillLines(nextBillLines);
      if (typeChanged) {
        await appendLedgerAudit({
          action: "edit_type",
          actor: actorId,
          closedMonthOverride: closedMonths.length > 0,
          closedMonths,
          summary: `แก้ประเภท ${description.trim()}`,
          items: [
            {
              id: entry.id,
              monthKey: ledgerMonthKey(entry.date),
              beforeType: prevType,
              beforeSource: String(entry.typeSource || ""),
              afterType: type,
              afterSource: String(typeSource || ""),
            },
          ],
        });
      }
      onSaved({
        description: description.trim(),
        amountIn: isIn ? value : 0,
        amountOut: isIn ? 0 : value,
        type,
        typeSource,
        typeAiReason,
      });
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
                onTypeModeChange={(value) => {
                  if (value === "auto") {
                    void runOwnerPreview();
                    return;
                  }
                  setTypeMode(value);
                  setOwnerLocked(true);
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

          {!isIn ? (
            <>
              {billLinesMsg ? (
                <p className="muted ledger-bill-lines-toast">{billLinesMsg}</p>
              ) : null}
              <LedgerBillLinesPanel
                ledgerEntryId={entry.id}
                receiptUrls={receiptUrls}
                billLines={billLines}
                stock={stock}
                isOwner={isOwner}
                actorId={actorId}
                formBusy={busy}
                setFormBusy={setBusy}
                onLinesChange={setBillLines}
                onError={(msg) => onError(msg || "")}
                onMsg={setBillLinesMsg}
              ledgerType={
                isOwner && ownerLocked && typeMode !== "auto"
                  ? typeMode
                  : previewType || entry.type || ""
              }
              />
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
