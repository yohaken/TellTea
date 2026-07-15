"use client";

import type { PhotoUploadProgress } from "@/lib/photo-upload";

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
          <strong>{progress.online ? "ออนไลน์ — เชื่อมฐานข้อมูลแล้ว" : "ออฟไลน์ — รอเครือข่าย"}</strong>
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
          {progress.phase === "uploading" || progress.phase === "preparing"
            ? ` · ไฟล์นี้ ${progress.percent}%`
            : null}
        </p>
        <p className="muted form-hint-inline">
          กรุณารอจนครบ — บันทึกทีละรูปเข้าฐานข้อมูล (ไม่ค้างที่คลัง Storage)
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
