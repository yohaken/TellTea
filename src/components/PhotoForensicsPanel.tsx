"use client";

import { useState } from "react";
import {
  entryHasPhotoFlag,
  scanPhotoForensics,
  type PhotoForensicsReport,
  type PhotoForensicsRowInput,
} from "@/lib/photo-forensics-scan";

export function PhotoForensicsPanel({
  rows,
  onPickEntry,
  onReport,
}: {
  rows: PhotoForensicsRowInput[];
  onPickEntry?: (entryId: string) => void;
  /** Notify parent so table can highlight */
  onReport?: (report: PhotoForensicsReport | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PhotoForensicsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function runScan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await scanPhotoForensics(rows);
      setReport(next);
      onReport?.(next);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message || "ตรวจรูปไม่สำเร็จ");
      setReport(null);
      onReport?.(null);
    } finally {
      setBusy(false);
    }
  }

  const mismatchN = report?.dateMismatch.length ?? 0;
  const dupN = report?.duplicates.length ?? 0;
  const flagged = report
    ? Object.keys(report.byEntryId).filter((id) => entryHasPhotoFlag(report, id)).length
    : 0;

  return (
    <div className="photo-forensics-panel">
      <div className="photo-forensics-bar">
        <button
          type="button"
          className="ghost-btn bulk-status-chip"
          disabled={busy || !rows.length}
          onClick={() => void runScan()}
        >
          {busy ? "กำลังตรวจ…" : "ตรวจรูป"}
        </button>
        {report ? (
          <button
            type="button"
            className="ghost-btn bulk-status-chip"
            onClick={() => setOpen((v) => !v)}
          >
            {flagged
              ? `พบ ${flagged} รายการ${open ? " ▴" : " ▾"}`
              : `ปกติ${open ? " ▴" : " ▾"}`}
          </button>
        ) : (
          <span className="muted photo-forensics-hint">
            เจ้าของ · เทียบวันถ่าย/อัปโหลด + รูปซ้ำในชุดที่แสดง
          </span>
        )}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {open && report ? (
        <div className="photo-forensics-body">
          <p className="muted photo-forensics-summary">
            สแกน {report.scannedEntries} รายการ · รูป {report.scannedPhotos}
            {report.photosWithCaptureMeta
              ? ` · มีวันถ่าย ${report.photosWithCaptureMeta}`
              : " · รูปเก่าอาจยังไม่มีวันถ่าย"}
            {" · "}
            วันไม่ตรง {mismatchN} · ซ้ำ {dupN} กลุ่ม
          </p>
          {mismatchN ? (
            <ul className="photo-forensics-list">
              {report.dateMismatch.slice(0, 12).map((row) => (
                <li key={`m-${row.entryId}`}>
                  <button
                    type="button"
                    className="linkish-btn"
                    onClick={() => onPickEntry?.(row.entryId)}
                  >
                    {row.label}
                  </button>
                  <span className="photo-forensics-tag">{row.hint}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {dupN ? (
            <ul className="photo-forensics-list">
              {report.duplicates.slice(0, 8).map((g) => (
                <li key={g.hash}>
                  <span className="photo-forensics-tag">รูปซ้ำ ×{g.entryIds.length}</span>{" "}
                  <button
                    type="button"
                    className="linkish-btn"
                    onClick={() => onPickEntry?.(g.entryIds[0]!)}
                  >
                    {g.labels.slice(0, 3).join(" · ")}
                    {g.labels.length > 3 ? ` +${g.labels.length - 3}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!flagged ? <p className="muted">ไม่พบสัญญาณในชุดนี้</p> : null}
        </div>
      ) : null}
    </div>
  );
}
