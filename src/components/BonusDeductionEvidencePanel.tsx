"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { monthInputValue, parseMonthInput } from "@/lib/bonus";
import {
  BONUS_DEDUCTION_EVIDENCE_MAX,
  BONUS_EVIDENCE_FORCE_SINCE,
  bonusEvidenceDocHasForceContent,
  bonusEvidencePileHasContent,
  bonusEvidenceViewOrder,
  getBonusDeductionMonth,
  listBonusEvidenceForceMonths,
  readBonusEvidenceAccepted,
  saveBonusDeductionMonthEvidence,
  shouldForceBonusEvidenceMonth,
  forcedSlideAcceptReady,
  forcedSlideAdvance,
  writeBonusEvidenceAccepted,
  type BonusDeductionMonthDoc,
  type BonusEvidencePileId,
} from "@/lib/bonus-deductions";
import { resolveEvidencePhotoSrc } from "@/lib/evidence-photos";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { bangkokDateKey } from "@/lib/utils";

type Slide =
  | { pile: BonusEvidencePileId; kind: "note"; text: string }
  | { pile: BonusEvidencePileId; kind: "photo"; url: string; photoIndex: number; photoTotal: number };

type ForceTarget = {
  periodMonth: string;
  year: number;
  month: number;
  doc: BonusDeductionMonthDoc;
};

function pileLabel(pile: BonusEvidencePileId): string {
  return pile === "caution" ? "ระวัง" : "ตัด";
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

function bangkokMonthNow(): string {
  const key = bangkokDateKey(Date.now());
  return key ? key.slice(0, 7) : monthInputValue();
}

/**
 * หลักฐานโบนัสต่องวด — กองระวัง (ไม่ตัด) + กองตัด (หักจริง)
 * พนักงาน: บังคับดูต่องวดตั้งแต่ BONUS_EVIDENCE_FORCE_SINCE · ไล่รูปแล้วติ๊กยอมรับ
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
  const [pilePreview, setPilePreview] = useState<{
    pile: BonusEvidencePileId;
    urls: string[];
  } | null>(null);
  const [forceTarget, setForceTarget] = useState<ForceTarget | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [acceptedTick, setAcceptedTick] = useState(0);
  const [viewedComplete, setViewedComplete] = useState(false);

  useBodyScrollLock(!!pilePreview || !!forceTarget || manualOpen);

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
    setViewedComplete(readBonusEvidenceAccepted(actorId, periodMonth));
  }, [actorId, periodMonth, acceptedTick]);

  /** สแกนเดือนค้างตั้งแต่ FORCE_SINCE → เดือนปัจจุบัน (Bangkok) / เดือนที่เลือก */
  useEffect(() => {
    if (isOwner || !actorId) {
      setForceTarget(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const nowYm = bangkokMonthNow();
      const endYm = periodMonth > nowYm ? periodMonth : nowYm;
      const startYm =
        BONUS_EVIDENCE_FORCE_SINCE > endYm ? endYm : BONUS_EVIDENCE_FORCE_SINCE;
      const months = listBonusEvidenceForceMonths(startYm, endYm);
      for (const ym of months) {
        if (cancelled) return;
        if (!shouldForceBonusEvidenceMonth(ym)) continue;
        if (readBonusEvidenceAccepted(actorId, ym)) continue;
        const parsed = parseMonthInput(ym);
        const d =
          ym === periodMonth && doc
            ? doc
            : await getBonusDeductionMonth(parsed.year, parsed.month);
        if (!bonusEvidenceDocHasForceContent(d)) continue;
        if (cancelled) return;
        setForceTarget({
          periodMonth: ym,
          year: parsed.year,
          month: parsed.month,
          doc: d,
        });
        return;
      }
      if (!cancelled) setForceTarget(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isOwner,
    actorId,
    periodMonth,
    doc,
    doc?.updatedAt,
    acceptedTick,
  ]);

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
  const forceActive = !!forceTarget;
  const viewerDoc = forceTarget?.doc || liveDoc;
  const viewerMonth = forceTarget?.periodMonth || periodMonth;
  const viewerOpen = forceActive || manualOpen;

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
      onInfo?.(
        `บันทึกหลักฐาน · ${periodMonth} · ระวัง ${cautionUrls.length} · ตัด ${cutUrls.length}`,
      );
    } catch (err) {
      onError((err as Error).message || "บันทึกหลักฐานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function onForceAccepted() {
    writeBonusEvidenceAccepted(actorId, viewerMonth);
    setManualOpen(false);
    setForceTarget(null);
    setAcceptedTick((n) => n + 1);
    onInfo?.(`ยอมรับหลักฐาน · ${viewerMonth}`);
  }

  return (
    <section className="bonus-evidence-panel" aria-label="หลักฐานระวังและตัดโบนัส">
      <header className="bonus-evidence-head">
        <h3 className="bonus-evidence-title">หลักฐานโบนัส · {periodMonth}</h3>
      </header>

      {isOwner ? (
        <>
          <div className="bonus-evidence-pile bonus-evidence-pile--caution">
            <h4 className="bonus-evidence-pile-title">1 · ระวัง</h4>
            <PhotoAttachMultiField
              label="รูประวัง"
              values={cautionUrls}
              onChange={setCautionUrls}
              onError={onError}
              max={BONUS_DEDUCTION_EVIDENCE_MAX}
              storageFolder="bonus-deductions"
              storageSlotKey={`caution-${periodMonth}`}
            />
            <label className="field bonus-evidence-note-field">
              <span>โน้ตระวัง</span>
              <input
                value={cautionNote}
                onChange={(e) => setCautionNote(e.target.value)}
                disabled={busy}
                maxLength={500}
              />
            </label>
            {cautionUrls.length ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setPilePreview({ pile: "caution", urls: cautionUrls })}
              >
                ดูตัวอย่าง ({cautionUrls.length})
              </button>
            ) : null}
          </div>

          <div className="bonus-evidence-pile bonus-evidence-pile--cut">
            <h4 className="bonus-evidence-pile-title">2 · ตัด</h4>
            <PhotoAttachMultiField
              label="รูปตัด"
              values={cutUrls}
              onChange={setCutUrls}
              onError={onError}
              max={BONUS_DEDUCTION_EVIDENCE_MAX}
              storageFolder="bonus-deductions"
              storageSlotKey={`cut-${periodMonth}`}
            />
            <label className="field bonus-evidence-note-field">
              <span>โน้ตตัด</span>
              <input
                value={cutNote}
                onChange={(e) => setCutNote(e.target.value)}
                disabled={busy}
                maxLength={500}
              />
            </label>
            {cutUrls.length ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setPilePreview({ pile: "cut", urls: cutUrls })}
              >
                ดูตัวอย่าง ({cutUrls.length})
              </button>
            ) : null}
          </div>

          <div className="bonus-evidence-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void onSave()}
            >
              {busy ? "…" : "บันทึก"}
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
            {viewedComplete
              ? `ยอมรับแล้ว · ${periodMonth}`
              : shouldForceBonusEvidenceMonth(periodMonth)
                ? `ยังไม่ยอมรับ · ${periodMonth}`
                : `งวดก่อน ${BONUS_EVIDENCE_FORCE_SINCE} ไม่บังคับ`}
          </p>
          {viewedComplete ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setManualOpen(true)}
            >
              ดูอีกครั้ง
            </button>
          ) : null}
        </div>
      ) : (
        <p className="muted bonus-evidence-empty">ยังไม่มีหลักฐานในงวดนี้</p>
      )}

      {pilePreview ? (
        <ImagePreviewModal
          urls={pilePreview.urls}
          title={`หลักฐาน${pileLabel(pilePreview.pile)} · ${periodMonth}`}
          onClose={() => setPilePreview(null)}
        />
      ) : null}

      {viewerOpen && bonusEvidenceDocHasForceContent(viewerDoc) ? (
        <BonusEvidenceForcedViewer
          periodMonth={viewerMonth}
          doc={viewerDoc}
          locked={forceActive}
          onDismiss={() => {
            if (forceActive) return;
            setManualOpen(false);
          }}
          onAccepted={onForceAccepted}
        />
      ) : null}
    </section>
  );
}

function BonusEvidenceForcedViewer({
  periodMonth,
  doc,
  locked,
  onDismiss,
  onAccepted,
}: {
  periodMonth: string;
  doc: BonusDeductionMonthDoc;
  /** true = บังคับค้าง — ปิดไม่ได้จนกว่าจะยอมรับ */
  locked: boolean;
  onDismiss: () => void;
  onAccepted: () => void;
}) {
  const slideKey = [
    doc.cautionNote,
    doc.note,
    ...doc.cautionUrls,
    ...doc.evidenceUrls,
  ].join("|");
  const slides = useMemo(() => buildForcedSlides(doc), [slideKey]);
  const [idx, setIdx] = useState(0);
  /** ใบสุดท้ายที่เคยถึง — ห้ามกระโดดข้าม */
  const [maxReached, setMaxReached] = useState(0);
  const [phase, setPhase] = useState<"slides" | "accept">("slides");
  const [readyAck, setReadyAck] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [imgReady, setImgReady] = useState(false);
  const [expandSrc, setExpandSrc] = useState<string | null>(null);
  const onDismissRef = useRef(onDismiss);
  const onAcceptedRef = useRef(onAccepted);
  onDismissRef.current = onDismiss;
  onAcceptedRef.current = onAccepted;

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(true);

  useEffect(() => {
    setIdx(0);
    setMaxReached(0);
    setPhase("slides");
    setReadyAck(false);
    setImgReady(false);
  }, [slideKey, periodMonth]);

  useEffect(() => {
    const token = `bonus-ev:${Date.now()}`;
    window.history.pushState({ bonusEv: token }, "");
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      if (!locked) onDismissRef.current();
      else window.history.pushState({ bonusEv: token }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (
        !closedByPop &&
        window.history.state &&
        (window.history.state as { bonusEv?: string }).bonusEv === token
      ) {
        window.history.replaceState(null, "");
      }
    };
  }, [locked]);

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
  const atEnd = forcedSlideAcceptReady(idx, slides.length, maxReached);
  const pile = slide.pile;
  const photoSrc =
    slide.kind === "photo" ? resolvedSrc[slide.url] || "" : "";
  const photoWaiting =
    slide.kind === "photo" &&
    !resolveError &&
    (resolving || !photoSrc || !imgReady);
  const canNext = !photoWaiting;

  function goNext() {
    if (!canNext) return;
    if (atEnd) {
      setPhase("accept");
      return;
    }
    const step = forcedSlideAdvance(idx, slides.length, maxReached);
    if (!step) return;
    if (step.idx === idx && step.atEnd) {
      setPhase("accept");
      return;
    }
    setImgReady(false);
    setIdx(step.idx);
    setMaxReached(step.maxReached);
  }

  function goPrev() {
    if (phase === "accept") {
      setPhase("slides");
      return;
    }
    if (idx <= 0) return;
    setImgReady(false);
    setIdx((i) => Math.max(0, i - 1));
  }

  const node = (
    <div
      className="bonus-forced-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="บังคับดูหลักฐานทีละรูป"
    >
      <div className="bonus-forced-card">
        {phase === "slides" ? (
          <>
            <header className="bonus-forced-head">
              <div>
                <p className="bonus-forced-pile">
                  กอง {pileLabel(pile)} · {periodMonth}
                </p>
                <p className="bonus-forced-kicker">บังคับดูทีละรูป</p>
              </div>
            </header>

            <p className="bonus-forced-progress">
              {idx + 1}/{slides.length}
              {slide.kind === "photo"
                ? ` · รูป ${slide.photoIndex}/${slide.photoTotal}`
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
                <button
                  type="button"
                  className="bonus-forced-img-btn"
                  onClick={() => setExpandSrc(photoSrc)}
                  title="ขยายรูปนี้"
                >
                  <img
                    src={photoSrc}
                    alt={`หลักฐาน${pileLabel(pile)}`}
                    className="bonus-forced-img"
                    ref={(el) => {
                      if (el?.complete) setImgReady(true);
                    }}
                    onLoad={() => setImgReady(true)}
                    onError={() => setImgReady(true)}
                  />
                </button>
              )}
            </div>

            <div className="bonus-forced-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={idx === 0}
                onClick={goPrev}
              >
                <ChevronLeft size={14} aria-hidden /> ก่อน
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={!canNext}
                onClick={goNext}
              >
                {atEnd ? (
                  "ต่อไป · ยอมรับ"
                ) : (
                  <>
                    ต่อไป <ChevronRight size={14} aria-hidden />
                  </>
                )}
              </button>
            </div>
            <p className="muted bonus-forced-foot">กดต่อไปทีละรูปจนครบ — ข้ามไม่ได้</p>
          </>
        ) : (
          <>
            <header className="bonus-forced-head">
              <p className="bonus-forced-pile">เดือน {periodMonth}</p>
            </header>
            <p className="bonus-forced-accept-lead">
              พร้อมปรับปรุงและยอมรับ
            </p>
            <label className="bonus-forced-accept-check">
              <input
                type="checkbox"
                checked={readyAck}
                onChange={(e) => setReadyAck(e.target.checked)}
              />
              <span>ยอมรับหลักฐานงวด {periodMonth}</span>
            </label>
            <div className="bonus-forced-actions">
              <button type="button" className="ghost-btn" onClick={goPrev}>
                กลับดูรูป
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={!readyAck}
                onClick={() => onAcceptedRef.current()}
              >
                ตกลง
              </button>
            </div>
            {!locked ? (
              <button
                type="button"
                className="ghost-btn bonus-forced-skip"
                onClick={() => onDismissRef.current()}
              >
                ปิด
              </button>
            ) : null}
          </>
        )}
      </div>

      {expandSrc ? (
        <ImagePreviewModal
          urls={[expandSrc]}
          title={`ขยาย · ${periodMonth}`}
          onClose={() => setExpandSrc(null)}
        />
      ) : null}
    </div>
  );

  if (!mounted) return null;
  return createPortal(node, document.body);
}
