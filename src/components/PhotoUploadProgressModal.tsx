"use client";

import type { PhotoUploadProgress } from "@/lib/photo-upload";

function formatBytes(n: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoUploadProgressModal({
  progress,
  onCancel,
}: {
  progress: PhotoUploadProgress;
  onCancel?: () => void;
}) {
  const canCancel =
    progress.phase === "checking" ||
    progress.phase === "preparing" ||
    progress.phase === "uploading";

  return (
    <div
      className="modal-backdrop photo-upload-progress-backdrop"
      role="presentation"
      aria-busy="true"
    >
      <div
        className="modal-card photo-upload-progress-card"
        role="dialog"
        aria-modal="true"
        aria-label="สถานะอัปโหลดรูป"
      >
        <h2 className="panel-title">อัปโหลดรูปหลักฐาน</h2>
        <p className="photo-upload-conn" data-online={progress.online ? "1" : "0"}>
          การเชื่อมต่อ:{" "}
          <strong>{progress.online ? "ออนไลน์ — เชื่อมคลังรูปแล้ว" : "ออฟไลน์ — รอเครือข่าย"}</strong>
        </p>
        <p className="muted photo-upload-msg">{progress.message}</p>
        {progress.fileCount > 0 ? (
          <p className="photo-upload-file">
            รูปที่ {Math.min(progress.fileIndex + 1, progress.fileCount)} / {progress.fileCount}
            {progress.fileName ? ` · ${progress.fileName}` : ""}
          </p>
        ) : null}
        <div className="photo-upload-bar-wrap" aria-hidden>
          <div
            className="photo-upload-bar"
            style={{ width: `${Math.max(2, Math.min(100, progress.overallPercent))}%` }}
          />
        </div>
        <p className="photo-upload-pct">
          รวม {progress.overallPercent}%
          {progress.phase === "uploading"
            ? ` · ไฟล์นี้ ${progress.percent}% (${formatBytes(progress.bytesTransferred)} / ${formatBytes(progress.totalBytes)})`
            : null}
        </p>
        <p className="muted form-hint-inline">
          กรุณารอจนครบ — ระบบอัปโหลดไฟล์จริงไปคลังรูป (ไม่ย่อคุณภาพเพื่อหลักฐานภาษี)
        </p>
        {canCancel && onCancel ? (
          <div className="entry-actions" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="ghost-btn" onClick={onCancel}>
              ยกเลิก
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
