"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import {
  BONUS_DEDUCTION_EVIDENCE_MAX,
  bonusEvidencePileHasContent,
  bonusEvidenceViewedStorageKey,
  bonusEvidenceViewOrder,
  saveBonusDeductionMonthEvidence,
  type BonusDeductionMonthDoc,
  type BonusEvidencePileId,
} from "@/lib/bonus-deductions";
import { resolveEvidencePhotoSrc } from "@/lib/evidence-photos";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

type Slide =
  | { pile: BonusEvidencePileId; kind: "note"; text: string }
  | { pile: BonusEvidencePileId; kind: "photo"; url: string; photoIndex: number; photoTotal: number };

function pileLabel(pile: BonusEvidencePileId): string {
  return pile === "caution" ? "ระวัง" : "ตัด";
}

function pileHint(pile: BonusEvidencePileId): string {
  return pile === "caution"
    ? "เตือนให้ระมัดระวัง — ไม่ตัดโบนัส"
    : "หลักฐานที่ตัดโบนัสจริง — หักคะแนนงวดนี้";
}

function buildForcedSlides(doc: BonusDeductionMonthDoc): Slide[] {
  const slides: Slide[] = [];
  for (const pile of bonusEvidenceViewOrder(doc)) {
    const note = pile === "caution" ? doc.cautionNote : doc.note;
    const urls = pile === "caution" ? doc.cautionUrls : doc.evidenceUrls;
    if (note.trim()) {
      slides.push({ pile, kind: "note", text: note.trim() });
    }
    urls.forEach((url, i) => {
      slides.push({
        pile,
        kind: "photo",
        url,
        photoIndex: i + 1,
        photoTotal: urls.length,
      });
    });
  }
  return slides;
}

function readViewed(actorId: string, periodMonth: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(bonusEvidenceViewedStorageKey(actorId, periodMonth)) === "1";
  } catch {
    return false;
  }
}

function writeViewed(actorId: string, periodMonth: string) {
  try {
    window.localStorage.setItem(bonusEvidenceViewedStorageKey(actorId, periodMonth), "1");
  } catch {
    /* ignore quota */
  }
}

/**
 * หลักฐานโบนัสต่องวด — กองระวัง (ไม่ตัด) + กองตัด (หักจริง)
 * พนักงานต้องสไลด์ดู ระวัง → ตัด ตามลำดับ
 */
export function BonusDeductionEvidencePanel({
  year,
  month,
  periodMonth,
  doc,
  isOwner,
  actorId = "",
  onError,
  onInfo,
  onSaved,
}: {
  year: number;
  month: number;
  periodMonth: string;
  doc: BonusDeductionMonthDoc | null;
  isOwner: boolean;
  /** ใช้จำว่าพนักงานดูครบงวดนี้แล้ว (เครื่องนี้) */
  actorId?: string;
  onError: (msg: string) => void;
  onInfo?: (msg: string) => void;
  onSaved?: (next: BonusDeductionMonthDoc) => void;
}) {
  const [cutUrls, setCutUrls] = useState<string[]>([]);
  const [cutNote, setCutNote] = useState("");
  const [cautionUrls, setCautionUrls] = useState<string[]>([]);
  const [cautionNote, setCautionNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** ดูรูปกองเดียว — เจ้าของ + พนักงาน (resolve evp: ใน ImagePreviewModal) */
  const [pilePreview, setPilePreview] = useState<{
    pile: BonusEvidencePileId;
    urls: string[];
  } | null>(null);
  const [forcedOpen, setForcedOpen] = useState(false);
  const [viewedComplete, setViewedComplete] = useState(false);

  useBodyScrollLock(!!pilePreview || forcedOpen);

  useEffect(() => {
    setCutUrls(doc?.evidenceUrls || []);
    setCutNote(doc?.note || "");
    setCautionUrls(doc?.cautionUrls || []);
    setCautionNote(doc?.cautionNote || "");
  }, [
    doc?.evidenceUrls,
    doc?.note,
    doc?.cautionUrls,
    doc?.cautionNote,
    periodMonth,
  ]);

  useEffect(() => {
    setViewedComplete(readViewed(actorId, periodMonth));
  }, [actorId, periodMonth]);

  const liveDoc: BonusDeductionMonthDoc = doc || {
    year,
    month,
    counts: { generalFail: 0, waste: 0 },
    evidenceUrls: [],
    note: "",
    cautionUrls: [],
    cautionNote: "",
    updatedAt: 0,
  };
  const viewOrder = useMemo(
    () => bonusEvidenceViewOrder(liveDoc),
    [
      liveDoc.cautionUrls,
      liveDoc.cautionNote,
      liveDoc.evidenceUrls,
      liveDoc.note,
    ],
  );
  const hasAny = viewOrder.length > 0;
  const hasCaution = bonusEvidencePileHasContent(liveDoc, "caution");
  const hasCut = bonusEvidencePileHasContent(liveDoc, "cut");

  async function onSave() {
    if (!isOwner) return;
    setBusy(true);
    try {
      const next = await saveBonusDeductionMonthEvidence(year, month, {
        evidenceUrls: cutUrls,
        note: cutNote,
        cautionUrls,
        cautionNote,
      });
      onSaved?.(next);
      onInfo?.(`บันทึกหลักฐาน · ${periodMonth} · ระวัง ${cautionUrls.length} · ตัด ${cutUrls.length}`);
    } catch (err) {
      onError((err as Error).message || "บันทึกหลักฐานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bonus-evidence-panel" aria-label="หลักฐานระวังและตัดโบนัส">
      <header className="bonus-evidence-head">
        <h3 className="bonus-evidence-title">หลักฐานโบนัส · {periodMonth}</h3>
        <p className="muted bonus-evidence-hint">
          ส่งรูปแยก 2 กอง: <strong>ระวัง</strong> (ไม่ตัด) แล้วค่อย{" "}
          <strong>ตัด</strong> (หักโบนัสจริง) — พนักงานต้องดูระวังก่อนถึงตัด
        </p>
      </header>

      {isOwner ? (
        <>
          <div className="bonus-evidence-pile bonus-evidence-pile--caution">
            <h4 className="bonus-evidence-pile-title">1 · ระวัง</h4>
            <p className="muted bonus-evidence-pile-hint">{pileHint("caution")}</p>
            <PhotoAttachMultiField
              label="รูประวัง"
              values={cautionUrls}
              onChange={setCautionUrls}
              onError={onError}
              max={BONUS_DEDUCTION_EVIDENCE_MAX}
              storageFolder="bonus-deductions"
              storageSlotKey={`caution-${periodMonth}`}
              hint={`ลำดับรูป = ลำดับที่พนักงานจะเห็น · สูงสุด ${BONUS_DEDUCTION_EVIDENCE_MAX} รูป`}
            />
            <label className="field">
              <span>โน้ตระวัง (สั้นๆ)</span>
              <input
                value={cautionNote}
                onChange={(e) => setCautionNote(e.target.value)}
                disabled={busy}
                placeholder="เช่น ระวังจุดนี้ในกะเย็น"
                maxLength={500}
              />
            </label>
            {cautionUrls.length ? (
              <button
                type="button"
                className="ghost-btn"
                style={{ marginTop: "0.35rem" }}
                onClick={() => setPilePreview({ pile: "caution", urls: cautionUrls })}
              >
                ดูตัวอย่างกองระวัง ({cautionUrls.length})
              </button>
            ) : null}
          </div>

          <div className="bonus-evidence-pile bonus-evidence-pile--cut">
            <h4 className="bonus-evidence-pile-title">2 · ตัด</h4>
            <p className="muted bonus-evidence-pile-hint">{pileHint("cut")}</p>
            <PhotoAttachMultiField
              label="รูปตัด"
              values={cutUrls}
              onChange={setCutUrls}
              onError={onError}
              max={BONUS_DEDUCTION_EVIDENCE_MAX}
              storageFolder="bonus-deductions"
              storageSlotKey={`cut-${periodMonth}`}
              hint={`แคปฟีดแบค / สาเหตุหักคะแนน · สูงสุด ${BONUS_DEDUCTION_EVIDENCE_MAX} รูป`}
            />
            <label className="field">
              <span>โน้ตตัด (สั้นๆ)</span>
              <input
                value={cutNote}
                onChange={(e) => setCutNote(e.target.value)}
                disabled={busy}
                placeholder="เช่น ฟีดแบคบริการ · ของเสียรอบ X"
                maxLength={500}
              />
            </label>
            {cutUrls.length ? (
              <button
                type="button"
                className="ghost-btn"
                style={{ marginTop: "0.35rem" }}
                onClick={() => setPilePreview({ pile: "cut", urls: cutUrls })}
              >
                ดูตัวอย่างกองตัด ({cutUrls.length})
              </button>
            ) : null}
          </div>

          <div className="module-form-actions" style={{ marginTop: "0.65rem" }}>
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
      ) : hasAny ? (
        <div className="bonus-evidence-staff">
          <div className="bonus-evidence-staff-piles">
            <div className="bonus-evidence-staff-pile">
              <strong>ระวัง</strong>
              <span className="muted">
                {hasCaution
                  ? [
                      liveDoc.cautionNote ? "มีโน้ต" : "",
                      liveDoc.cautionUrls.length
                        ? `${liveDoc.cautionUrls.length} รูป`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "ไม่มี"}
              </span>
              {liveDoc.cautionUrls.length ? (
                <EntryPhotoIndicator
                  imageUrls={liveDoc.cautionUrls}
                  label="ระวัง"
                  onView={() =>
                    setPilePreview({
                      pile: "caution",
                      urls: liveDoc.cautionUrls,
                    })
                  }
                />
              ) : null}
            </div>
            <div className="bonus-evidence-staff-pile">
              <strong>ตัด</strong>
              <span className="muted">
                {hasCut
                  ? [
                      liveDoc.note ? "มีโน้ต" : "",
                      liveDoc.evidenceUrls.length
                        ? `${liveDoc.evidenceUrls.length} รูป`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "ไม่มี"}
              </span>
              {liveDoc.evidenceUrls.length ? (
                <EntryPhotoIndicator
                  imageUrls={liveDoc.evidenceUrls}
                  label="ตัด"
                  onView={() =>
                    setPilePreview({
                      pile: "cut",
                      urls: liveDoc.evidenceUrls,
                    })
                  }
                />
              ) : null}
            </div>
          </div>
          <p className="muted bonus-evidence-staff-order">
            ต้องดูตามลำดับ:{" "}
            {viewOrder.map((p) => pileLabel(p)).join(" → ") || "—"}
            {viewedComplete ? " · ดูครบแล้วบนเครื่องนี้" : " · ยังดูไม่ครบ"}
            {" · แตะไอคอนรูปเปิดดูได้เลย"}
          </p>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setForcedOpen(true)}
          >
            {viewedComplete ? "ดูอีกครั้งตามลำดับ" : "เริ่มดู · ระวังก่อน แล้วตัด"}
          </button>
        </div>
      ) : (
        <p className="muted bonus-evidence-empty">
          ยังไม่มีหลักฐานระวัง/ตัดในงวดนี้ — เจ้าของแนบตอนปิดเดือน
        </p>
      )}

      {pilePreview ? (
        <ImagePreviewModal
          urls={pilePreview.urls}
          title={`หลักฐาน${pileLabel(pilePreview.pile)} · ${periodMonth}`}
          onClose={() => setPilePreview(null)}
        />
      ) : null}

      {forcedOpen ? (
        <BonusEvidenceForcedViewer
          periodMonth={periodMonth}
          doc={liveDoc}
          onClose={() => setForcedOpen(false)}
          onComplete={() => {
            writeViewed(actorId, periodMonth);
            setViewedComplete(true);
            onInfo?.(`ดูหลักฐานครบ · ${periodMonth}`);
          }}
        />
      ) : null}
    </section>
  );
}

function BonusEvidenceForcedViewer({
  periodMonth,
  doc,
  onClose,
  onComplete,
}: {
  periodMonth: string;
  doc: BonusDeductionMonthDoc;
  onClose: () => void;
  onComplete: () => void;
}) {
  const slideKey = [
    doc.cautionNote,
    doc.note,
    ...doc.cautionUrls,
    ...doc.evidenceUrls,
  ].join("|");
  const slides = useMemo(() => buildForcedSlides(doc), [slideKey]);
  const [idx, setIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  /** ref → displayable src (data:/https) — evp: ต้อง resolve ก่อนใส่ <img> */
  const [resolvedSrc, setResolvedSrc] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  /** กันปิดทันทีเมื่อ parent re-render แล้วสร้าง onClose ใหม่ (ดูแบบพนักงาน / snapshot) */
  const onCloseRef = useRef(onClose);
  const onCompleteRef = useRef(onComplete);
  onCloseRef.current = onClose;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(true);

  useEffect(() => {
    const token = `bonus-ev:${Date.now()}`;
    window.history.pushState({ bonusEv: token }, "");
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // อย่า history.back() — จะไปปิด instance ที่ remount (Strict / parent refresh)
      if (
        !closedByPop &&
        window.history.state &&
        (window.history.state as { bonusEv?: string }).bonusEv === token
      ) {
        window.history.replaceState(null, "");
      }
    };
  }, []);

  useEffect(() => {
    const photoRefs = slides
      .filter((s): s is Extract<Slide, { kind: "photo" }> => s.kind === "photo")
      .map((s) => s.url);
    if (!photoRefs.length) {
      setResolvedSrc({});
      setResolving(false);
      setResolveError("");
      return;
    }
    let cancelled = false;
    setResolving(true);
    setResolveError("");
    void (async () => {
      const map: Record<string, string> = {};
      try {
        for (const ref of photoRefs) {
          if (cancelled) return;
          map[ref] = await resolveEvidencePhotoSrc(ref);
        }
        if (cancelled) return;
        setResolvedSrc(map);
        setResolving(false);
      } catch (err) {
        if (cancelled) return;
        setResolveError((err as Error).message || "โหลดรูปไม่สำเร็จ");
        setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slideKey]);

  if (!slides.length) {
    return null;
  }

  const slide = slides[idx]!;
  const atEnd = idx >= slides.length - 1;
  const pile = slide.pile;
  const photoSrc =
    slide.kind === "photo" ? resolvedSrc[slide.url] || "" : "";

  function goNext() {
    if (atEnd) {
      onCompleteRef.current();
      onCloseRef.current();
      return;
    }
    setIdx((i) => Math.min(slides.length - 1, i + 1));
  }

  function goPrev() {
    setIdx((i) => Math.max(0, i - 1));
  }

  const node = (
    <div className="bonus-forced-backdrop" role="dialog" aria-label="ดูหลักฐานตามลำดับ">
      <div className="bonus-forced-card">
        <header className="bonus-forced-head">
          <div>
            <p className="bonus-forced-pile">
              กอง {pileLabel(pile)} · {periodMonth}
            </p>
            <p className="muted bonus-forced-sub">{pileHint(pile)}</p>
          </div>
          <button
            type="button"
            className="ghost-btn bonus-forced-close"
            aria-label="ปิด"
            onClick={() => onCloseRef.current()}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <p className="muted bonus-forced-progress">
          สไลด์ {idx + 1}/{slides.length}
          {slide.kind === "photo"
            ? ` · รูป ${slide.photoIndex}/${slide.photoTotal} ในกองนี้`
            : " · โน้ต"}
        </p>

        <div className="bonus-forced-stage">
          {slide.kind === "note" ? (
            <p className="bonus-forced-note">{slide.text}</p>
          ) : resolveError ? (
            <p className="error-text">{resolveError}</p>
          ) : resolving || !photoSrc ? (
            <p className="muted">กำลังโหลดรูป…</p>
          ) : (
            <img
              src={photoSrc}
              alt={`หลักฐาน${pileLabel(pile)}`}
              className="bonus-forced-img"
            />
          )}
        </div>

        <div className="bonus-forced-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={idx === 0}
            onClick={goPrev}
          >
            <ChevronLeft size={16} aria-hidden /> ก่อนหน้า
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={slide.kind === "photo" && (resolving || !photoSrc) && !resolveError}
            onClick={goNext}
          >
            {atEnd ? (
              "ดูครบแล้ว"
            ) : (
              <>
                ต่อไป <ChevronRight size={16} aria-hidden />
              </>
            )}
          </button>
        </div>
        <p className="muted bonus-forced-foot">
          ต้องไล่ครบทุกสไลด์ (ระวังก่อน แล้วตัด) — ปิดก่อนจบจะยังไม่นับว่าดูครบ
        </p>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(node, document.body);
}
