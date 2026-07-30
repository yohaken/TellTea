"use client";

import { useEffect, useState } from "react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import {
  BONUS_DEDUCTION_EVIDENCE_MAX,
  saveBonusDeductionMonthEvidence,
  type BonusDeductionMonthDoc,
} from "@/lib/bonus-deductions";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/**
 * หลักฐานหักโบนัสต่องวด — แนบที่ตัดคะแนน (ไม่ปนตารางคน)
 * พนักงานอ่านได้ · เจ้าของแก้รูป+โน้ต
 */
export function BonusDeductionEvidencePanel({
  year,
  month,
  periodMonth,
  doc,
  isOwner,
  onError,
  onInfo,
  onSaved,
}: {
  year: number;
  month: number;
  periodMonth: string;
  doc: BonusDeductionMonthDoc | null;
  isOwner: boolean;
  onError: (msg: string) => void;
  onInfo?: (msg: string) => void;
  onSaved?: (next: BonusDeductionMonthDoc) => void;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  useBodyScrollLock(preview);

  useEffect(() => {
    setUrls(doc?.evidenceUrls || []);
    setNote(doc?.note || "");
  }, [doc?.evidenceUrls, doc?.note, periodMonth]);

  const hasEvidence = urls.length > 0 || Boolean(note.trim());

  async function onSave() {
    if (!isOwner) return;
    setBusy(true);
    try {
      const next = await saveBonusDeductionMonthEvidence(year, month, {
        evidenceUrls: urls,
        note,
      });
      onSaved?.(next);
      onInfo?.(`บันทึกหลักฐานหัก · ${periodMonth}`);
    } catch (err) {
      onError((err as Error).message || "บันทึกหลักฐานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bonus-evidence-panel" aria-label="หลักฐานหักโบนัส">
      <header className="bonus-evidence-head">
        <h3 className="bonus-evidence-title">หลักฐานหักโบนัส · {periodMonth}</h3>
        <p className="muted bonus-evidence-hint">
          แคปฟีดแบคลูกค้า / สาเหตุตัดคะแนน — เก็บตามงวด ย้อนหลังได้ด้วยตัวเลือกเดือนด้านบน
        </p>
      </header>

      {isOwner ? (
        <>
          <PhotoAttachMultiField
            label="รูปหลักฐาน"
            values={urls}
            onChange={setUrls}
            onError={onError}
            max={BONUS_DEDUCTION_EVIDENCE_MAX}
            storageFolder="bonus-deductions"
            storageSlotKey={`deduct-${periodMonth}`}
            hint="ถ่ายหรือแนบแคป — พนักงานดูได้เพื่อความโปร่งใส"
          />
          <label className="field">
            <span>โน้ตสาเหตุ (สั้นๆ)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              placeholder="เช่น ฟีดแบคบริการ · ของเสียรอบ X"
              maxLength={500}
            />
          </label>
          <div className="module-form-actions" style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void onSave()}
            >
              {busy ? "กำลังบันทึก..." : "บันทึกหลักฐานงวดนี้"}
            </button>
          </div>
        </>
      ) : hasEvidence ? (
        <div className="bonus-evidence-staff">
          {note ? <p className="bonus-evidence-note">{note}</p> : null}
          {urls.length ? (
            <div className="bonus-evidence-staff-photos">
              <EntryPhotoIndicator
                imageUrls={urls}
                label="หลักฐานหัก"
                onView={() => setPreview(true)}
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setPreview(true)}
              >
                ดูหลักฐาน ({urls.length})
              </button>
            </div>
          ) : (
            <p className="muted">มีโน้ตหัก — ยังไม่มีรูป</p>
          )}
        </div>
      ) : (
        <p className="muted bonus-evidence-empty">
          ยังไม่มีหลักฐานหักในงวดนี้ — เจ้าของแนบตอนตัดคะแนนสิ้นเดือน
        </p>
      )}

      {preview && urls.length ? (
        <ImagePreviewModal
          urls={urls}
          title={`หลักฐานหัก · ${periodMonth}`}
          onClose={() => setPreview(false)}
        />
      ) : null}
    </section>
  );
}
