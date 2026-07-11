"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { deleteAllLedgerEntries, importLedgerEntries } from "@/lib/ledger";
import { parseLedgerWorkbook } from "@/lib/xlsx-import";
import { formatBaht } from "@/lib/utils";

export default function ImportPage() {
  return (
    <AuthGate>
      <ImportView />
    </AuthGate>
  );
}

function ImportView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    count: number;
    sumIn: number;
    sumOut: number;
    balance: number;
  } | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    if (staff && staff.role !== "owner") router.replace("/ledger/");
  }, [staff, router]);

  if (staff?.role !== "owner") return null;

  async function onFile(file: File | null) {
    setError(null);
    setMessage(null);
    setPreview(null);
    setFileBuffer(null);
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseLedgerWorkbook(buffer, user?.email || "import");
      const sumIn = rows.reduce((s, r) => s + r.amountIn, 0);
      const sumOut = rows.reduce((s, r) => s + r.amountOut, 0);
      setFileBuffer(buffer);
      setPreview({
        count: rows.length,
        sumIn,
        sumOut,
        balance: sumIn - sumOut,
      });
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
        const removed = await deleteAllLedgerEntries((done) => {
          setMessage(`กำลังลบรายการเดิม... ${done}`);
        });
        setMessage(`ลบแล้ว ${removed} รายการ — กำลังนำเข้า...`);
      }
      const rows = parseLedgerWorkbook(fileBuffer, user.email);
      const imported = await importLedgerEntries(rows, (done, total) => {
        setMessage(`นำเข้าแล้ว ${done}/${total}`);
      });
      setMessage(`นำเข้าสำเร็จ ${imported} รายการ`);
      setTimeout(() => router.replace("/ledger/"), 800);
    } catch (err) {
      setError((err as Error).message || "นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="panel-title">นำเข้าจาก Excel</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        รองรับไฟล์ชีทร้านคอลัมน์: <strong>วันที่ · รายการ · เข้า · ออก · คงเหลือ · type</strong>
        <br />
        (เช่น ไฟล์ รายวันเดิมรายการ.xlsx)
      </p>

      <div className="form-card">
        <div className="field">
          <label htmlFor="xlsx">เลือกไฟล์ .xlsx</label>
          <input
            id="xlsx"
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
              รวมเข้า {formatBaht(preview.sumIn)} · รวมออก {formatBaht(preview.sumOut)}
            </p>
            <p>
              คงเหลือจากชีท ≈ <strong>{formatBaht(preview.balance)}</strong>
            </p>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="muted">{message}</p> : null}

        <div className="btn-row" style={{ marginTop: "1rem" }}>
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
    </div>
  );
}
