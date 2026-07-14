"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listLedgerEntries } from "@/lib/ledger";
import { listOwnerBookEntries } from "@/lib/owner-books";
import {
  completePnlMonths,
  filterCategoryRowsByMonths,
  filterPnlRowsByMonths,
  loadPnlReport,
} from "@/lib/pnl";
import { backfillOwnerNotesFromPatch } from "@/lib/owner-notes-backfill";
import { exportCombinedTablesXlsx } from "@/lib/xlsx-export";

export default function ExportPage() {
  return (
    <AuthGate>
      <ExportView />
    </AuthGate>
  );
}

function ExportView() {
  const { staff } = useAuth();
  const router = useRouter();
  const [ledger, setLedger] = useState(true);
  const [ownerBooks, setOwnerBooks] = useState(true);
  const [pnl, setPnl] = useState(true);
  const [pnlSummaryOnly, setPnlSummaryOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff && !can(staff, "exportData")) router.replace("/ledger/");
  }, [staff, router]);

  if (!can(staff, "exportData")) return null;

  async function onExport() {
    if (!ledger && !ownerBooks && !pnl) {
      setError("เลือกอย่างน้อย 1 รายการ");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("กำลังรวมตารางเป็นไฟล์เดียว...");
    try {
      const parts: string[] = [];
      const payload: Parameters<typeof exportCombinedTablesXlsx>[0] = {};

      if (ledger) {
        const rows = await listLedgerEntries();
        payload.ledger = rows;
        parts.push(`พนักงาน ${rows.length}`);
      }
      if (ownerBooks) {
        const rows = await listOwnerBookEntries();
        payload.ownerBooks = rows;
        parts.push(`เจ้าของ ${rows.length}`);
      }
      if (pnl) {
        const report = await loadPnlReport();
        if (pnlSummaryOnly) {
          const months = completePnlMonths(report.pnl, report.incomeByMonth);
          payload.pnl = {
            ...report,
            staff: filterCategoryRowsByMonths(report.staff, months),
            owner: filterCategoryRowsByMonths(report.owner, months),
            combined: filterCategoryRowsByMonths(report.combined, months),
            pnl: filterPnlRowsByMonths(report.pnl, months),
          };
          parts.push(`P&L สรุป ${months.length} เดือน`);
        } else {
          payload.pnl = report;
          parts.push(`P&L ทั้งหมด ${report.pnl.length} เดือน`);
        }
      }

      exportCombinedTablesXlsx(payload);
      setMessage(`ส่งออกไฟล์เดียวแล้ว: ${parts.join(" · ")}`);
    } catch (err) {
      setError((err as Error).message || "ส่งออกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onBackfillNotes() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await backfillOwnerNotesFromPatch();
      setMessage(
        `เติม note แล้ว ${result.updated} รายการ` +
          (result.skipped ? ` · ข้ามที่มีอยู่ ${result.skipped}` : "") +
          (result.missing ? ` · ไม่พบคู่ ${result.missing}` : ""),
      );
    } catch (err) {
      setError((err as Error).message || "เติม note ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="panel-title">ส่งออก</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เลือกตาราง แล้วโหลดเป็น <strong>ไฟล์ Excel เดียว</strong> — แยกเป็นแผ่นงานตามตาราง
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="form-card entry-form">
        <label className="check-row">
          <input type="checkbox" checked={ledger} onChange={(e) => setLedger(e.target.checked)} />
          บช.พนักงาน (ledger) → แผ่นงาน «บช.พนักงาน»
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ownerBooks}
            onChange={(e) => setOwnerBooks(e.target.checked)}
          />
          บช.เจ้าของ (รวม note) → แผ่นงาน «บช.เจ้าของ»
        </label>
        <label className="check-row">
          <input type="checkbox" checked={pnl} onChange={(e) => setPnl(e.target.checked)} />
          รายงานสรุป P&amp;L → 4 แผ่นงาน (พนักงาน / เจ้าของ / รวม / กำไรขาดทุน)
        </label>
        {pnl ? (
          <label className="check-row" style={{ marginLeft: "1.25rem" }}>
            <input
              type="checkbox"
              checked={pnlSummaryOnly}
              onChange={(e) => setPnlSummaryOnly(e.target.checked)}
            />
            โหมดสรุป P&amp;L — เฉพาะเดือนที่มีรายได้ (+ แถวรวมท้ายแผ่น)
          </label>
        ) : null}

        <div className="entry-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void onExport()}>
            {busy ? "กำลังส่งออก..." : "ส่งออก Excel (ไฟล์เดียว)"}
          </button>
          <span aria-hidden style={{ width: "2.6rem" }} />
          <span aria-hidden style={{ width: "2.6rem" }} />
        </div>
      </div>

      {can(staff, "ownerBooks") ? (
        <div className="form-card" style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ margin: "0 0 0.75rem", textAlign: "left" }}>
            ครั้งเดียว: เติม note จากไฟล์ «บช. เจ้าของ.xlsx» เดิม (20 รายการที่มี note)
          </p>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={() => void onBackfillNotes()}
          >
            เติม note จากไฟล์เดิม
          </button>
        </div>
      ) : null}
    </div>
  );
}
