"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  deleteAllOwnerBookEntries,
  importOwnerBookEntries,
  OWNER_BOOKS_LIVE_MAX,
  OWNER_BOOKS_PAGE_SIZE,
  subscribeOwnerBooksPage,
  subscribeOwnerBooksTotalOut,
  type OwnerBookEntry,
} from "@/lib/owner-books";
import { parseOwnerBooksWorkbook } from "@/lib/xlsx-import";
import { formatBaht, formatDateShort, formatPlainNumber } from "@/lib/utils";

export default function OwnerBooksPage() {
  return (
    <AuthGate>
      <OwnerBooksView />
    </AuthGate>
  );
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; sumOut: number } | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [showImport, setShowImport] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (staff && staff.role !== "owner") {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (staff?.role !== "owner") return;
    return subscribeOwnerBooksTotalOut(
      (n) => setTotalOut(n),
      (err) => setError(err.message || "โหลดยอดไม่สำเร็จ"),
    );
  }, [staff]);

  useEffect(() => {
    if (staff?.role !== "owner") return;
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

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || liveLimit >= OWNER_BOOKS_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + OWNER_BOOKS_PAGE_SIZE, OWNER_BOOKS_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: "240px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, loading, hasMore, entries.length]);

  if (staff?.role !== "owner") return null;

  async function onFile(file: File | null) {
    setError(null);
    setMessage(null);
    setPreview(null);
    setFileBuffer(null);
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseOwnerBooksWorkbook(buffer, user?.email || "import");
      const sumOut = rows.reduce((s, r) => s + r.amountOut, 0);
      setFileBuffer(buffer);
      setPreview({ count: rows.length, sumOut });
    } catch (err) {
      setError((err as Error).message || "อ่านไฟล์ไม่สำเร็จ");
    }
  }

  async function runImport(replace: boolean) {
    if (!fileBuffer || !user?.email) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (replace) {
        const removed = await deleteAllOwnerBookEntries((done) => {
          setMessage(`กำลังลบรายการเดิม... ${done}`);
        });
        setMessage(`ลบแล้ว ${removed} รายการ — กำลังนำเข้า...`);
      }
      const rows = parseOwnerBooksWorkbook(fileBuffer, user.email);
      const imported = await importOwnerBookEntries(rows, (done, total) => {
        setMessage(`นำเข้าแล้ว ${done}/${total}`);
      });
      setMessage(`นำเข้าสำเร็จ ${imported} รายการ`);
      setShowImport(false);
      setPreview(null);
      setFileBuffer(null);
    } catch (err) {
      setError((err as Error).message || "นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

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
          onClick={() => setShowImport((v) => !v)}
        >
          {showImport ? "ปิดนำเข้า" : "นำเข้า Excel"}
        </button>
      </div>

      {showImport ? (
        <div className="form-card" style={{ marginBottom: "0.85rem" }}>
          <p className="muted" style={{ margin: "0 0 0.75rem", textAlign: "left" }}>
            ไฟล์ <strong>บช. เจ้าของ.xlsx</strong> — คอลัมน์: วันที่ · รายการ · ออก
          </p>
          <div className="field">
            <label htmlFor="owner-xlsx">เลือกไฟล์ .xlsx</label>
            <input
              id="owner-xlsx"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
              disabled={busy}
            />
          </div>
          {preview ? (
            <div className="import-preview">
              <p>
                พบ <strong>{preview.count}</strong> รายการ
              </p>
              <p>
                รวมออก {formatBaht(preview.sumOut)}
              </p>
            </div>
          ) : null}
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn action-in"
              disabled={busy || !preview}
              onClick={() => void runImport(true)}
            >
              แทนที่ทั้งหมดแล้วนำเข้า
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !preview}
              onClick={() => void runImport(false)}
            >
              เพิ่มต่อท้าย
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — กด &quot;นำเข้า Excel&quot; เลือกไฟล์ บช. เจ้าของ.xlsx</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-out">ออก</th>
                  <th className="col-act">หมวด</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id} className="row-out">
                    <td className="col-date">{formatDateShort(row.date)}</td>
                    <td className="col-desc" title={row.description}>
                      {row.description}
                    </td>
                    <td className="col-out">
                      {row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}
                    </td>
                    <td className="col-act">
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        {row.type || "—"}
                      </span>
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
              {liveLimit >= OWNER_BOOKS_LIVE_MAX && entries.length >= OWNER_BOOKS_LIVE_MAX
                ? `แสดงล่าสุด ${entries.length} รายการ`
                : `ครบทุกรายการแล้ว (${entries.length})`}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
