"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { ArrowUpCircle, ImagePlus, Loader2, Trash2 } from "lucide-react";
import {
  MENU_SQUARE_PX,
  prepareMenuItemImage,
  type MenuImageCropSource,
} from "@/lib/pos-menu-image";
import { MENU_IMAGE_BACKUP_MAX } from "@/lib/pos-menu";

export type PosMenuPhotoBackupsProps = {
  backups: string[];
  uploading: boolean;
  setUploading: (v: boolean) => void;
  onBackupReady: (dataUrl: string) => Promise<void>;
  onPromote: (index: number) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
  onRequestCrop: (source: MenuImageCropSource) => void;
  onError: (msg: string) => void;
  maxBackups?: number;
};

/**
 * รูปสำรองใต้รูปหลัก — แนบ / สลับขึ้นหลัก / ลบ (ยังไม่แสดงขายจนกว่าจะ promote)
 */
export function PosMenuPhotoBackups({
  backups,
  uploading,
  setUploading,
  onBackupReady,
  onPromote,
  onRemove,
  onRequestCrop,
  onError,
  maxBackups = MENU_IMAGE_BACKUP_MAX,
}: PosMenuPhotoBackupsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const full = backups.length >= maxBackups;

  const processFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || full) return;
      setUploading(true);
      onError("");
      try {
        const prep = await prepareMenuItemImage(file);
        if (prep.mode === "done") {
          await onBackupReady(prep.dataUrl);
        } else {
          onRequestCrop(prep.source);
        }
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [full, onBackupReady, onError, onRequestCrop, setUploading],
  );

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (full || uploading) return;
    void processFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="pos-menu-photo-backups">
      <div className="pos-menu-photo-backups-head">
        <h3 className="pos-menu-photo-backups-title">รูปสำรอง</h3>
        <span className="muted pos-menu-photo-backups-count">
          {backups.length}/{maxBackups}
        </span>
      </div>
      <p className="muted pos-menu-photo-backups-hint">
        ใบออกแบบใหม่เก็บไว้เทียบ — กดสลับขึ้นหลักเมื่อพร้อม · ไม่แสดงขายจนกว่าจะสลับ
      </p>

      <ul className="pos-menu-photo-backups-grid">
        {backups.map((url, index) => (
          <li key={`backup-${index}`} className="pos-menu-photo-backup-tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="pos-menu-photo-backup-img" decoding="async" loading="lazy" />
            <div className="pos-menu-photo-backup-actions">
              <button
                type="button"
                className="ghost-btn pos-menu-photo-backup-btn"
                title="สลับขึ้นเป็นรูปหลัก"
                disabled={uploading}
                onClick={() => void onPromote(index).catch((err) => onError((err as Error).message))}
              >
                <ArrowUpCircle size={14} aria-hidden />
                ใช้หลัก
              </button>
              <button
                type="button"
                className="ghost-btn pos-menu-photo-backup-btn"
                title="ลบรูปสำรอง"
                disabled={uploading}
                onClick={() => void onRemove(index).catch((err) => onError((err as Error).message))}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          </li>
        ))}

        {!full ? (
          <li>
            <button
              type="button"
              className={[
                "pos-menu-photo-backup-add",
                dragOver ? "is-dragover" : "",
                uploading ? "is-busy" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={uploading}
              aria-label="เพิ่มรูปสำรอง"
              onClick={() => fileRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={onDrop}
            >
              {uploading ? (
                <Loader2 size={20} className="pos-menu-photo-spin" aria-hidden />
              ) : (
                <ImagePlus size={20} aria-hidden />
              )}
              <span>{uploading ? "กำลังบีบอัด..." : "เพิ่มสำรอง"}</span>
            </button>
          </li>
        ) : null}
      </ul>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="pos-menu-photo-input"
        onChange={(e) => void processFile(e.target.files?.[0])}
      />

      <p className="muted pos-menu-photo-hint">
        JPEG {MENU_SQUARE_PX}px เหมือนรูปหลัก · สูงสุด {maxBackups} ใบ
      </p>
    </div>
  );
}
