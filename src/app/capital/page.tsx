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
import { ArrowDownLeft, ArrowUpRight, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { PhotoUploadProgressModal } from "@/components/PhotoUploadProgressModal";
import { SheetDateCell } from "@/components/SheetDateCell";
import { useAuth } from "@/lib/auth";
import {
  addCapitalBookEntry,
  CAPITAL_BOOKS_LIVE_MAX,
  CAPITAL_BOOKS_PAGE_SIZE,
  CAPITAL_BOOKS_RECEIPT_MAX,
  deleteCapitalBookEntry,
  ensureCapitalBooksSeeded,
  getCapitalBookReceiptUrls,
  listCapitalBookEntriesSince,
  subscribeCapitalBooksPage,
  subscribeCapitalBooksSummary,
  updateCapitalBookEntry,
  type CapitalBookEntry,
  type CapitalBooksSummary,
} from "@/lib/capital-books";
import { can } from "@/lib/permissions";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
} from "@/lib/photo-upload";
import { friendlyFirestoreWriteError } from "@/lib/receipts";
import { daysAgoMs } from "@/lib/query-window";
import { filterLedgerRows, sortByDateNewestFirst } from "@/lib/smart-search";
import {
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export default function CapitalBooksPage() {
  return (
    <AuthGate>
      <CapitalBooksView />
    </AuthGate>
  );
}

function toDateInput(ms: number) {
  return todayInputValue(new Date(ms));
}

function CapitalBooksView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<CapitalBookEntry[]>([]);
  const [summary, setSummary] = useState<CapitalBooksSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLimit, setLiveLimit] = useState(CAPITAL_BOOKS_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<CapitalBookEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [photoUploadRowId, setPhotoUploadRowId] = useState<string | null>(null);
  const [rowUploadProgress, setRowUploadProgress] = useState<PhotoUploadProgress | null>(
    null,
  );
  const [imagePreview, setImagePreview] = useState<{
    urls: string[];
    title: string;
    entryDateMs?: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [searchPool, setSearchPool] = useState<CapitalBookEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const photoEntryRef = useRef<CapitalBookEntry | null>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoGalleryRef = useRef<HTMLInputElement>(null);
  const rowUploadCancelRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seedTriedRef = useRef(false);
  const deferredQuery = useDeferredValue(query.trim());

  useBodyScrollLock(
    !!adding || !!editing || !!photoUploadRowId || !!imagePreview || !!rowUploadProgress,
  );

  useEffect(() => {
    if (staff && !can(staff, "ownerBooks")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "ownerBooks") || !actorId || seedTriedRef.current) return;
    seedTriedRef.current = true;
    setSeeding(true);
    void ensureCapitalBooksSeeded(actorId)
      .catch((err) => {
        setError((err as Error).message || "ใส่ข้อมูลย้อนหลังไม่สำเร็จ");
      })
      .finally(() => setSeeding(false));
  }, [staff, actorId]);

  useEffect(() => {
    if (!can(staff, "ownerBooks")) return;
    return subscribeCapitalBooksSummary(
      (next) => setSummary(next),
      (err) => setError(err.message || "โหลดสรุปทุนไม่สำเร็จ"),
    );
  }, [staff]);

  useEffect(() => {
    if (!can(staff, "ownerBooks")) return;
    setLoading(true);
    const unsub = subscribeCapitalBooksPage(
      liveLimit,
      (page) => {
        setEntries(sortByDateNewestFirst(page.entries));
        setHasMore(page.hasMore);
        setLoading(false);
        setLoadingMore(false);
      },
      (err) => {
        setLoading(false);
        setLoadingMore(false);
        setError(err.message || "โหลดบัญชีทุนไม่สำเร็จ");
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
    void listCapitalBookEntriesSince(daysAgoMs(1800))
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
    return sortByDateNewestFirst(filterLedgerRows(source, deferredQuery));
  }, [entries, searchPool, deferredQuery]);

  const loadMore = useCallback(() => {
    if (deferredQuery) return;
    if (!hasMore || loadingMore || liveLimit >= CAPITAL_BOOKS_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + CAPITAL_BOOKS_PAGE_SIZE, CAPITAL_BOOKS_LIVE_MAX));
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

  async function handleRowPhotoFiles(files: FileList | null) {
    const row = photoEntryRef.current;
    if (!row || !files?.length || !actorId) return;
    const existing = getCapitalBookReceiptUrls(row);
    const room = CAPITAL_BOOKS_RECEIPT_MAX - existing.length;
    if (room <= 0) {
      setError(`แนบได้สูงสุด ${CAPITAL_BOOKS_RECEIPT_MAX} รูปต่อรายการ`);
      setPhotoUploadRowId(null);
      photoEntryRef.current = null;
      return;
    }
    const batch = Array.from(files).slice(0, room);
    if (files.length > room) {
      setError(`แนบได้สูงสุด ${CAPITAL_BOOKS_RECEIPT_MAX} รูป — รับเฉพาะ ${room} รูปแรก`);
    } else {
      setError(null);
    }
    setPhotoUploadRowId(null);
    rowUploadCancelRef.current = false;
    try {
      const urls = await uploadEvidencePhotos(batch, {
        folder: "capital-books",
        slotKey: `row-${row.id}`,
        cancelRef: rowUploadCancelRef,
        onProgress: setRowUploadProgress,
      });
      if (!urls.length) throw new Error("อัปโหลดรูปไม่สำเร็จ");
      await updateCapitalBookEntry(row.id, {
        receiptUrls: [...existing, ...urls].slice(0, CAPITAL_BOOKS_RECEIPT_MAX),
      });
    } catch (err) {
      if (!rowUploadCancelRef.current) {
        setError(friendlyFirestoreWriteError(err, "อัปโหลดรูปไม่สำเร็จ"));
      }
    } finally {
      setRowUploadProgress(null);
      photoEntryRef.current = null;
      if (photoCameraRef.current) photoCameraRef.current.value = "";
      if (photoGalleryRef.current) photoGalleryRef.current.value = "";
    }
  }

  if (!can(staff, "ownerBooks")) return null;

  const isOwner = staff?.role === "owner";
  const balance = summary?.balance ?? null;
  const balanceHint =
    balance == null
      ? ""
      : balance < 0
        ? "ถอนเกินทุนลงทุน — กำไรที่ถอนออกแล้ว"
        : balance > 0
          ? "ทุนยังค้างในกิจการ"
          : "คืนทุนครบเท่าที่ลงทุน";

  return (
    <div className="capital-books-page owner-books-page module-page">
      {isOwner ? <OwnerBooksModeSwitch active="capital" /> : null}

      {!loading ? (
        <div className="ledger-staff-toolbar capital-books-toolbar">
          <div className="table-search ledger-table-search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหา…"
              autoComplete="off"
              enterKeyHint="search"
              aria-label="ค้นหาในตารางทุน"
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
          <div
            className="ledger-balance-over-in capital-summary-box"
            aria-label="สรุปทุน เข้าลบออก"
            title={balanceHint}
          >
            <span>สรุปทุน (เข้า−ออก)</span>
            <strong>
              {balance == null ? "…" : `฿${formatPlainNumber(balance)}`}
            </strong>
          </div>
        </div>
      ) : null}

      {!loading && summary ? (
        <p className="muted capital-summary-meta">
          เข้า ฿{formatPlainNumber(summary.totalIn)} · ออก ฿
          {formatPlainNumber(summary.totalOut)}
          {balanceHint ? ` · ${balanceHint}` : ""}
          {seeding ? " · กำลังใส่ข้อมูลย้อนหลัง…" : ""}
        </p>
      ) : null}

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
        <p className="empty">ยังไม่มีรายการ — กด + กรอก เพื่อบันทึกลงทุน / คืนทุน</p>
      ) : !loading && deferredQuery && !searchLoading && filteredEntries.length === 0 ? (
        <p className="empty">ไม่พบรายการที่ตรงกับคำค้น</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap ledger-staff-sheet capital-books-sheet sheet-bleed">
            <table className="sheet-table sheet-table--dense">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-in">เข้า</th>
                  <th className="col-out">ออก</th>
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
                        <button
                          type="button"
                          className="desc-link"
                          title="แตะเพื่อแก้ไข"
                          onClick={() => setEditing(row)}
                        >
                          {row.description}
                        </button>
                        {getCapitalBookReceiptUrls(row).length ? (
                          <EntryPhotoIndicator
                            imageUrls={getCapitalBookReceiptUrls(row)}
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
                            onClick={() => {
                              photoEntryRef.current = row;
                              setPhotoUploadRowId(row.id);
                            }}
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
                    <td className="col-in">
                      {row.amountIn > 0 ? formatPlainNumber(row.amountIn) : ""}
                    </td>
                    <td className="col-out">
                      {row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}
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
                  {liveLimit >= CAPITAL_BOOKS_LIVE_MAX &&
                  entries.length >= CAPITAL_BOOKS_LIVE_MAX
                    ? `แสดงล่าสุด ${entries.length} รายการ`
                    : `ครบทุกรายการแล้ว (${entries.length})`}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {adding && actorId ? (
        <CapitalEntryModal
          mode="add"
          createdBy={actorId}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
        />
      ) : null}

      {editing && actorId ? (
        <CapitalEntryModal
          mode="edit"
          entry={editing}
          createdBy={actorId}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
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
          onClick={() => {
            setPhotoUploadRowId(null);
            photoEntryRef.current = null;
          }}
        >
          <div className="photo-action-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 700, fontSize: "0.95rem" }}>
              เพิ่มรูปหลักฐาน
            </p>
            <p
              className="muted"
              style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", textAlign: "left" }}
            >
              ถ่ายหรือแนบได้หลายรูป · สูงสุด {CAPITAL_BOOKS_RECEIPT_MAX} รูปต่อรายการ
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
              onClick={() => {
                setPhotoUploadRowId(null);
                photoEntryRef.current = null;
              }}
            >
              ออก
            </button>
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="บันทึกทุน"
        formOpen={adding}
        onAdd={() => setAdding(true)}
        addLabel="+ กรอก"
        variant="default"
      />
    </div>
  );
}

function CapitalEntryModal({
  mode,
  entry,
  createdBy,
  onClose,
  onSaved,
  onError,
}: {
  mode: "add" | "edit";
  entry?: CapitalBookEntry;
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const isEdit = mode === "edit" && entry;
  const initialKind: "in" | "out" = entry && entry.amountOut > 0 ? "out" : "in";
  const [kind, setKind] = useState<"in" | "out">(initialKind);
  const [date, setDate] = useState(
    isEdit ? toDateInput(entry.date) : todayInputValue(),
  );
  const [description, setDescription] = useState(
    isEdit ? entry.description : initialKind === "in" ? "ลงทุน" : "คืนทุน",
  );
  const [amount, setAmount] = useState(
    isEdit ? String(entry.amountIn > 0 ? entry.amountIn : entry.amountOut) : "",
  );
  const [receiptUrls, setReceiptUrls] = useState<string[]>(
    isEdit ? getCapitalBookReceiptUrls(entry) : [],
  );
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function report(msg: string) {
    setLocalError(msg);
    onError(msg);
  }

  function onKindChange(next: "in" | "out") {
    setKind(next);
    if (!isEdit) {
      setDescription(next === "in" ? "ลงทุน" : "คืนทุน");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!createdBy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const urls = receiptUrls.filter(Boolean).slice(0, CAPITAL_BOOKS_RECEIPT_MAX);
      if (urls.some((u) => u.startsWith("data:"))) {
        throw new Error("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่เพื่อบันทึกเข้าคลังหลักฐาน");
      }
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error("ใส่จำนวนเงินให้ถูกต้อง");
      const amountIn = kind === "in" ? n : 0;
      const amountOut = kind === "out" ? n : 0;
      if (isEdit && entry) {
        await updateCapitalBookEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountIn,
          amountOut,
          receiptUrls: urls,
        });
      } else {
        await addCapitalBookEntry({
          date: parseDateInput(date),
          description,
          amountIn,
          amountOut,
          createdBy,
          receiptUrls: urls,
        });
      }
      onSaved();
    } catch (err) {
      report(friendlyFirestoreWriteError(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!entry || deleting) return;
    if (!window.confirm(`ลบรายการ「${entry.description}」?`)) return;
    setDeleting(true);
    setLocalError(null);
    try {
      await deleteCapitalBookEntry(entry.id);
      onSaved();
    } catch (err) {
      report(friendlyFirestoreWriteError(err, "ลบไม่สำเร็จ"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="modal-backdrop edit-modal is-module-form"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "แก้ไขรายการทุน" : "กรอกรายการทุน"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">{isEdit ? "แก้ไขรายการทุน" : "กรอกรายการทุน"}</h2>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิด"
            disabled={busy || deleting}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted form-hint-inline">
          เข้า = ลงทุน · ออก = คืนทุน / ถอนทุน · แนบสลิปได้
        </p>
        {localError ? <p className="error-text">{localError}</p> : null}
        <form className="form-card module-entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="field capital-kind-field" role="group" aria-label="ประเภททุน">
            <label>ประเภท</label>
            <div className="capital-kind-toggle">
              <button
                type="button"
                className={kind === "in" ? "ghost-btn is-active-in" : "ghost-btn"}
                onClick={() => onKindChange("in")}
                disabled={busy || deleting}
              >
                <ArrowDownLeft size={14} aria-hidden />
                เข้า · ลงทุน
              </button>
              <button
                type="button"
                className={kind === "out" ? "ghost-btn is-active-out" : "ghost-btn"}
                onClick={() => onKindChange("out")}
                disabled={busy || deleting}
              >
                <ArrowUpRight size={14} aria-hidden />
                ออก · คืนทุน
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="capital-date">วันที่</label>
            <input
              id="capital-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              disabled={busy || deleting}
            />
          </div>
          <div className="field">
            <label htmlFor="capital-desc">รายการ</label>
            <input
              id="capital-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              disabled={busy || deleting}
            />
          </div>
          <div className="field">
            <label htmlFor="capital-amount">
              จำนวนเงิน{kind === "in" ? "เข้า" : "ออก"} (บาท)
            </label>
            <input
              id="capital-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={kind === "in" ? "450000" : "100000"}
              required
              disabled={busy || deleting}
            />
          </div>
          <PhotoAttachMultiField
            label="สลิป / รูปถ่าย (ถ้ามี)"
            values={receiptUrls}
            onChange={setReceiptUrls}
            onError={report}
            max={CAPITAL_BOOKS_RECEIPT_MAX}
            storageFolder="capital-books"
            storageSlotKey={entry?.id || "capital-new"}
            hint={`บันทึกหลักฐานเข้าฐานข้อมูล · สูงสุด ${CAPITAL_BOOKS_RECEIPT_MAX} รูป`}
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
          {isEdit && entry ? (
            <EntryTimestampsMeta
              entryDate={entry.date}
              createdAt={entry.createdAt}
              updatedAt={entry.updatedAt}
              era="be"
            />
          ) : null}
          <div className="module-form-actions">
            <button
              type="submit"
              className={kind === "in" ? "primary-btn action-in" : "primary-btn action-out"}
              disabled={busy || deleting}
            >
              {busy ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึก"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || deleting}
              onClick={onClose}
            >
              ออก
            </button>
            {isEdit ? (
              <button
                type="button"
                className="ghost-btn danger-text"
                disabled={busy || deleting}
                onClick={() => void onDelete()}
                title="ลบรายการ"
              >
                <Trash2 size={16} aria-hidden />
                {deleting ? "กำลังลบ..." : "ลบ"}
              </button>
            ) : null}
          </div>
        </form>
        {previewUrls ? (
          <ImagePreviewModal
            urls={previewUrls}
            title="สลิป / รูปถ่าย"
            onClose={() => setPreviewUrls(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
