"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  deleteLedgerEntry,
  getLedgerBalance,
  LEDGER_LIVE_MAX,
  LEDGER_PAGE_SIZE,
  subscribeLedgerPage,
  updateLedgerEntry,
} from "@/lib/ledger";
import { guessTypeFromDescription } from "@/lib/ledger-labels";
import { loadCachedLedger, saveCachedLedger } from "@/lib/cache";
import { loadSheetZoom, saveSheetZoom } from "@/lib/prefs";
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
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const balanceRef = useRef<number | null>(null);
  const hasRowsRef = useRef(false);
  const balanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawServerRef = useRef(false);
  const isOwner = staff?.role === "owner";

  useLayoutEffect(() => {
    const cached = loadCachedLedger();
    if (cached?.entries.length) {
      setEntries(cached.entries);
      setBalance(cached.balance);
      balanceRef.current = cached.balance;
      setHasMore(cached.hasMore);
      setLoading(false);
      hasRowsRef.current = true;
    }
  }, []);

  useEffect(() => {
    setZoom(loadSheetZoom(1));
  }, []);

  const changeZoom = useCallback((delta: number) => {
    setZoom((prev) => {
      const next = Math.min(1.6, Math.max(0.7, Math.round((prev + delta) * 100) / 100));
      saveSheetZoom(next);
      return next;
    });
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

  const scheduleBalance = useCallback(() => {
    if (balanceTimerRef.current) clearTimeout(balanceTimerRef.current);
    balanceTimerRef.current = setTimeout(() => {
      void getLedgerBalance()
        .then((next) => {
          setBalance(next);
          balanceRef.current = next;
          const cached = loadCachedLedger();
          if (cached) saveCachedLedger({ ...cached, balance: next });
        })
        .catch(() => {
          /* keep last known balance */
        });
    }, 280);
  }, []);

  useEffect(() => {
    setError(null);
    if (hasRowsRef.current) setRefreshing(true);
    else setLoading(true);
    sawServerRef.current = false;

    const unsub = subscribeLedgerPage(
      liveLimit,
      (page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore && liveLimit < LEDGER_LIVE_MAX);
        hasRowsRef.current = page.entries.length > 0;
        setLoading(false);
        setLoadingMore(false);
        persistSnapshot(page.entries, page.hasMore, balanceRef.current);

        if (!page.fromCache) {
          sawServerRef.current = true;
          setRefreshing(false);
          scheduleBalance();
        } else if (sawServerRef.current) {
          setRefreshing(false);
        } else {
          setRefreshing(false);
          scheduleBalance();
        }
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

    return () => {
      unsub();
      if (balanceTimerRef.current) clearTimeout(balanceTimerRef.current);
    };
  }, [liveLimit, persistSnapshot, scheduleBalance]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || liveLimit >= LEDGER_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + LEDGER_PAGE_SIZE, LEDGER_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit]);

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
      <div className="balance-hero">
        <p>
          คงเหลือ
          {refreshing ? <span className="sync-dot" aria-hidden> ·</span> : null}
        </p>
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

      <div className="sheet-toolbar">
        <span>ขนาดตาราง</span>
        <div className="zoom-controls">
          <button type="button" className="qty-btn" aria-label="ย่อ" onClick={() => changeZoom(-0.1)}>
            −
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="qty-btn" aria-label="ขยาย" onClick={() => changeZoom(0.1)}>
            +
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากโอนเข้าหรือบันทึกเงินออก</p>
      ) : !loading ? (
        <>
          <div
            className="sheet-wrap"
            style={{ "--sheet-zoom": zoom } as CSSProperties}
          >
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-in">เข้า</th>
                  <th className="col-out">ออก</th>
                  <th className="col-act">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id} className={row.amountIn > 0 ? "row-in" : "row-out"}>
                    <td className="col-date">{formatDateShort(row.date)}</td>
                    <td className="col-desc">
                      {row.description}
                      {row.receiptUrl ? (
                        <a
                          className="receipt-link"
                          href={row.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          สลิป
                        </a>
                      ) : null}
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
          onSaved={() => {
            setEditing(null);
            scheduleBalance();
          }}
          onError={setError}
        />
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

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const value = Number(amount);
      await updateLedgerEntry(entry.id, {
        date: parseDateInput(date),
        description,
        amountIn: isIn ? value : 0,
        amountOut: isIn ? 0 : value,
        type: entry.type || guessTypeFromDescription(description),
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
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="แก้ไขรายการ"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="panel-title">ลบ / แก้ไข</h2>
        <form onSubmit={(e) => void onSave(e)}>
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
              required
            />
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
          <div className="btn-row">
            <button type="submit" className="primary-btn" disabled={busy}>
              บันทึก
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
          </div>
          <button
            type="button"
            className="danger-btn"
            style={{ width: "100%", marginTop: "0.75rem" }}
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
