"use client";

import { useMemo, useState } from "react";
import {
  PROD_PHOTO_QA_LOOKBACK_DAYS,
  scanProdPhotoQaBatch,
  type ProdPhotoQaBatchReport,
  type ProdPhotoQaScanRow,
} from "@/lib/prod-photo-qa";
import type { ProdPhotoQa, ProdProduct } from "@/lib/production";
import { formatDateShort } from "@/lib/utils";

export function ProdPhotoQaBatchPanel({
  rows,
  products,
  onUpdatePhotoQa,
  onPickEntry,
  className,
}: {
  rows: ProdPhotoQaScanRow[];
  products: Pick<ProdProduct, "id" | "name">[];
  onUpdatePhotoQa: (entryId: string, photoQa: ProdPhotoQa) => Promise<void>;
  onPickEntry?: (entryId: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ProdPhotoQaBatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const eligible = useMemo(
    () =>
      rows.filter((r) => {
        const urls = r.imageUrls || [];
        if (!urls.length) return false;
        const s = r.photoQa?.verifyStatus;
        return !s || s === "skipped" || s === "pending";
      }).length,
    [rows],
  );

  async function runScan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await scanProdPhotoQaBatch(rows, {
        products,
        lookbackDays: PROD_PHOTO_QA_LOOKBACK_DAYS,
        updateEntry: onUpdatePhotoQa,
      });
      setReport(next);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message || "สแกนขัดแย้งไม่สำเร็จ");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={["photo-forensics-panel", "prod-photo-qa-panel", className].filter(Boolean).join(" ")}>
      <div className="photo-forensics-bar">
        <button
          type="button"
          className="ghost-btn bulk-status-chip"
          disabled={busy || !eligible}
          onClick={() => void runScan()}
          title={`ย้อน ${PROD_PHOTO_QA_LOOKBACK_DAYS} วัน · ตรวจความขัดแย้งสินค้าในกลุ่มสับสน`}
        >
          {busy ? "กำลังตรวจขัดแย้ง…" : `ขัดแย้ง ${PROD_PHOTO_QA_LOOKBACK_DAYS} วัน`}
        </button>
        {report ? (
          <button
            type="button"
            className="ghost-btn bulk-status-chip"
            onClick={() => setOpen((v) => !v)}
          >
            {report.flagged
              ? `ขัดแย้ง ${report.flagged} รายการ${open ? " ▴" : " ▾"}`
              : `ไม่พบขัดแย้ง${open ? " ▴" : " ▾"}`}
          </button>
        ) : (
          <span className="muted photo-forensics-hint">
            ย้อน {PROD_PHOTO_QA_LOOKBACK_DAYS} วัน · ค้างตรวจ ~{eligible} · กลุ่มมันเท่านั้น
          </span>
        )}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {open && report ? (
        <div className="photo-forensics-body">
          <p className="muted photo-forensics-summary">
            {formatDateShort(report.windowStart)}–{formatDateShort(report.windowEnd)} · สแกน{" "}
            {report.scanned} · ติดธง {report.flagged} · ผ่าน {report.ok} · ข้าม {report.skipped}
            {report.errors.length ? ` · ผิดพลาด ${report.errors.length}` : ""}
          </p>
          {report.flaggedIds.length ? (
            <ul className="photo-forensics-list">
              {rows
                .filter((r) => report.flaggedIds.includes(r.entryId))
                .slice(0, 20)
                .map((row) => (
                  <li key={`qa-${row.entryId}`}>
                    <button
                      type="button"
                      className="linkish-btn"
                      onClick={() => onPickEntry?.(row.entryId)}
                    >
                      {row.label}
                    </button>
                    <span className="photo-forensics-tag">รายการไม่ถูกต้อง</span>
                  </li>
                ))}
            </ul>
          ) : null}
          {report.errors.length ? (
            <ul className="photo-forensics-list">
              {report.errors.slice(0, 10).map((row) => (
                <li key={`err-${row.entryId}`}>
                  <span>{row.label}</span>
                  <span className="photo-forensics-tag">{row.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
