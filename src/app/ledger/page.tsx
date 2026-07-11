"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  currentBalance,
  deleteLedgerEntry,
  listLedgerEntries,
  withRunningBalance,
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

  const rows = useMemo(() => withRunningBalance(entries).reverse(), [entries]);
  const balance = useMemo(() => currentBalance(entries), [entries]);

  return (
    <div>
      <div className="balance-hero">
        <p>คงเหลือ</p>
        <strong>{formatBaht(balance)}</strong>
      </div>

      <div className="quick-actions">
        {isOwner ? (
          <Link href="/in/" className="primary-btn action-in">
            โอนเข้า
          </Link>
        ) : null}
        <Link href="/out/" className="primary-btn action-out">
          บันทึกเงินออก
        </Link>
      </div>

      <h1 className="panel-title">รายการ</h1>
      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — เริ่มจากโอนเข้าหรือบันทึกเงินออก</p>
      ) : (
        <div className="list-card ledger-list">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`ledger-row ${row.amountIn > 0 ? "is-in" : "is-out"}`}
            >
              <div className="ledger-main">
                <div className="ledger-top">
                  <span className="ledger-date">{formatDateShort(row.date)}</span>
                  {row.type ? <span className="ledger-type">{row.type}</span> : null}
                </div>
                <strong>{row.description}</strong>
                <div className="ledger-amounts">
                  {row.amountIn > 0 ? (
                    <span className="amt-in">+{formatBaht(row.amountIn)}</span>
                  ) : (
                    <span className="amt-out">−{formatBaht(row.amountOut)}</span>
                  )}
                  <span className="amt-bal">คงเหลือ {formatBaht(row.balance)}</span>
                </div>
              </div>
              {isOwner ? (
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() =>
                    void deleteLedgerEntry(row.id)
                      .then(reload)
                      .catch((err) => setError(err.message || "ลบไม่สำเร็จ"))
                  }
                >
                  ลบ
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
