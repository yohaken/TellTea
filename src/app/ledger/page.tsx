"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  currentBalance,
  deleteLedgerEntry,
  listLedgerEntries,
} from "@/lib/ledger";
import type { LedgerEntry } from "@/lib/types";
import { formatBaht, formatDateShort } from "@/lib/utils";

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isOwner = staff?.role === "owner";

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listLedgerEntries());
    } catch (err) {
      setError((err as Error).message || "โหลดบัญชีไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // newest first — like scrolling the sheet from the bottom up for daily use
  const rows = useMemo(
    () => [...entries].sort((a, b) => b.date - a.date || b.createdAt - a.createdAt),
    [entries],
  );
  const balance = useMemo(() => currentBalance(entries), [entries]);

  return (
    <div>
      <div className="balance-hero">
        <p>คงเหลือ</p>
        <strong>{formatBaht(balance)}</strong>
      </div>

      <div className="quick-actions">
        <Link href="/out/" className="primary-btn action-out">
          บันทึกเงินออก
        </Link>
        <Link href="/stock/" className="ghost-btn" style={{ width: "100%" }}>
          สต็อก
        </Link>
        {isOwner ? (
          <Link href="/in/" className="primary-btn action-in">
            โอนเข้า
          </Link>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากโอนเข้าหรือบันทึกเงินออก</p>
      ) : !loading ? (
        <div className="sheet-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th className="col-date">วันที่</th>
                <th className="col-desc">รายการ</th>
                <th className="col-in">เข้า</th>
                <th className="col-out">ออก</th>
                {isOwner ? <th className="col-act" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.amountIn > 0 ? "row-in" : "row-out"}>
                  <td className="col-date">{formatDateShort(row.date)}</td>
                  <td className="col-desc">{row.description}</td>
                  <td className="col-in">
                    {row.amountIn > 0 ? formatBaht(row.amountIn) : ""}
                  </td>
                  <td className="col-out">
                    {row.amountOut > 0 ? formatBaht(row.amountOut) : ""}
                  </td>
                  {isOwner ? (
                    <td className="col-act">
                      <button
                        type="button"
                        className="sheet-del"
                        onClick={() =>
                          void deleteLedgerEntry(row.id)
                            .then(reload)
                            .catch((err) => setError(err.message || "ลบไม่สำเร็จ"))
                        }
                      >
                        ลบ
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
