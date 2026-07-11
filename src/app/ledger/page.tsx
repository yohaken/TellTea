"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  deleteLedgerEntry,
  frequentDescriptions,
  LEDGER_LIVE_MAX,
  LEDGER_PAGE_SIZE,
  listRecentLedgerEntries,
  recomputeLedgerBalance,
  subscribeLedgerBalance,
  subscribeLedgerPage,
  updateLedgerEntry,
} from "@/lib/ledger";
import { guessTypeFromDescription } from "@/lib/ledger-labels";
import { loadCachedLedger, saveCachedLedger } from "@/lib/cache";
import {
  compressImageForUpload,
  fileToReceiptDataUrl,
  saveImageToDevice,
} from "@/lib/receipts";
import type { LedgerEntry } from "@/lib/types";
import { formatBaht, formatDateShort, parseDateInput, todayInputValue } from "@/lib/utils";

export default function LedgerPage() {
  return (
    <AuthGate>
      <LedgerView />
    </AuthGate>
  );
}

function LedgerView() {
  const { staff } = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [liveLimit, setLiveLimit] = useState(LEDGER_PAGE_SIZE);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [photoRowId, setPhotoRowId] = useState<string | null>(null);
  const photoEntryRef = useRef<LedgerEntry | null>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoGalleryRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const balanceRef = useRef<number | null>(null);
  const hasRowsRef = useRef(false);
  const isOwner = staff?.role === "owner";

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

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || liveLimit >= LEDGER_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + LEDGER_PAGE_SIZE, LEDGER_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit]);

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
      setPhotoRowId(null);
      photoEntryRef.current = null;
    }
  }

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading) return;
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
  }, [loadMore, loading, hasMore, entries.length]);

  return (
    <div>
      <div className="balance-bar">
        <span>
          คงเหลือ
          {refreshing ? <span className="sync-dot" aria-hidden> ·</span> : null}
        </span>
        <strong>{balance == null ? "…" : formatBaht(balance)}</strong>
      </div>

      <div className="quick-actions">
        <Link href="/out/" className="primary-btn action-out">
          บันทึกเงินออก
        </Link>
        {isOwner ? (
          <Link href="/in/" className="primary-btn action-in">
            โอนเข้า
          </Link>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากโอนเข้าหรือบันทึกเงินออก</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-photo">รูปภาพ</th>
                  <th className="col-in">เข้า</th>
                  <th className="col-out">ออก</th>
                  <th className="col-act">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id} className={row.amountIn > 0 ? "row-in" : "row-out"}>
                    <td className="col-date">{formatDateShort(row.date)}</td>
                    <td className="col-desc">{row.description}</td>
                    <td className="col-photo">
                      <button
                        type="button"
                        className={row.receiptUrl ? "photo-btn has-photo" : "photo-btn"}
                        onClick={() => {
                          photoEntryRef.current = row;
                          setPhotoRowId(row.id);
                        }}
                        title="เพิ่มรูป"
                      >
                        {row.receiptUrl ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.1a2 2 0 0 0 1.5-.7l2.3-2.3a2 2 0 0 1 1.4-.6H16a2 2 0 0 1 1.4.6l2.3 2.3a2 2 0 0 0 1.5.7H21a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="3"/>
                          </svg>
                        ) : (
                          <span>เพิ่มรูป</span>
                        )}
                      </button>
                    </td>
                    <td className="col-in">{row.amountIn > 0 ? formatBaht(row.amountIn) : ""}</td>
                    <td className="col-out">{row.amountOut > 0 ? formatBaht(row.amountOut) : ""}</td>
                    <td className="col-act">
                      <button type="button" className="sheet-edit" onClick={() => setEditing(row)}>
                        ลบ/แก้ไข
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {editing ? (
        <EditEntryModal
          entry={editing}
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
        onChange={(e) => void handleRowPhotoFile(e.target.files?.[0] || null)}
      />
      <input
        ref={photoGalleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void handleRowPhotoFile(e.target.files?.[0] || null)}
      />

      {photoRowId ? (
        <div
          className="modal-backdrop"
          onClick={() => { setPhotoRowId(null); photoEntryRef.current = null; }}
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
              onClick={() => { setPhotoRowId(null); photoEntryRef.current = null; }}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toDateInput(ms: number) {
  const d = new Date(ms);
  return todayInputValue(d);
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 10);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 10);
  }, [description, suggestions]);

  useEffect(() => {
    void listRecentLedgerEntries(200)
      .then((entries) => setSuggestions(frequentDescriptions(entries)))
      .catch(() => setSuggestions([]));
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
        type: entry.type || guessTypeFromDescription(description),
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
    <div className="modal-backdrop edit-modal" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="แก้ไขรายการ"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="panel-title">ลบ / แก้ไข</h2>
        {notice ? <p className="muted" style={{ margin: "0 0 0.75rem" }}>{notice}</p> : null}
        <form className="form-card" onSubmit={(e) => void onSave(e)}>
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

          <div className="field">
            <span className="field-label">สลิป / รูปถ่าย</span>
            <div className="receipt-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => cameraRef.current?.click()}
              >
                ถ่ายด้วยกล้อง
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => galleryRef.current?.click()}
              >
                เลือกจากคลังรูป
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
            ) : entry.receiptUrl ? (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={entry.receiptUrl} alt="สลิปเดิม" className="receipt-preview" />
                <p className="muted" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
                  ถ่ายใหม่จะแทนที่รูปเดิม
                </p>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: "0.5rem", textAlign: "left" }}>
                ถ่ายแล้วระบบพยายามบันทึกลงเครื่องทันที แล้วแนบเข้าบิลนี้
              </p>
            )}
          </div>

          <div className="btn-row">
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
          </div>
          <button
            type="button"
            className="danger-btn"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={() => void onDelete()}
          >
            ลบรายการนี้
          </button>
        </form>
      </div>
    </div>
  );
}
