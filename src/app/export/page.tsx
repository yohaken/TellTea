"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listLedgerEntries } from "@/lib/ledger";
import { listOwnerBookEntries } from "@/lib/owner-books";
import { loadPnlReport } from "@/lib/pnl";
import { backfillOwnerNotesFromPatch } from "@/lib/owner-notes-backfill";
import {
  exportLedgerXlsx,
  exportOwnerBooksXlsx,
  exportPnlXlsx,
} from "@/lib/xlsx-export";

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
    setMessage(null);
    try {
      const parts: string[] = [];
      if (ledger) {
        setMessage("กำลังส่งออกบช.พนักงาน...");
        const rows = await listLedgerEntries();
        exportLedgerXlsx(rows);
        parts.push(`พนักงาน ${rows.length}`);
      }
      if (ownerBooks) {
        setMessage("กำลังส่งออกบช.เจ้าของ...");
        const rows = await listOwnerBookEntries();
        exportOwnerBooksXlsx(rows);
        parts.push(`เจ้าของ ${rows.length}`);
      }
      if (pnl) {
        setMessage("กำลังส่งออกรายงาน...");
        const report = await loadPnlReport();
        exportPnlXlsx(report);
        parts.push(`รายงาน ${report.pnl.length} เดือน`);
      }
      setMessage(`ส่งออกแล้ว: ${parts.join(" · ")}`);
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
        เลือกบช.หรือรายงาน แล้วโหลดเป็น Excel ลงเครื่อง
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="form-card entry-form">
        <label className="check-row">
          <input type="checkbox" checked={ledger} onChange={(e) => setLedger(e.target.checked)} />
          บช.พนักงาน (ledger)
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ownerBooks}
            onChange={(e) => setOwnerBooks(e.target.checked)}
          />
          บช.เจ้าของ (รวม note)
        </label>
        <label className="check-row">
          <input type="checkbox" checked={pnl} onChange={(e) => setPnl(e.target.checked)} />
          รายงานสรุป P&amp;L / แยกหมวดรายเดือน
        </label>

        <div className="entry-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void onExport()}>
            {busy ? "กำลังส่งออก..." : "ส่งออก Excel"}
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
