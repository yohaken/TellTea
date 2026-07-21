"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export type AiSaveStage = "sending" | "classifying" | "saving" | "done";

const STAGE_LABEL: Record<AiSaveStage, string> = {
  sending: "กำลังส่งชื่อรายการ…",
  classifying: "AI กำลังจัดประเภทบัญชี…",
  saving: "กำลังบันทึกรายการ…",
  done: "เสร็จแล้ว",
};

type Props = {
  stage: AiSaveStage;
  detail?: string;
};

/** ป๊อบอัพรอ AI ตอนกดบันทึก — สถานะจริง + นาฬิกาเดิน ไม่ใช่นับถอยหลังปลอม */
export function AiSaveProgressModal({ stage, detail }: Props) {
  const [mounted, setMounted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  useBodyScrollLock(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setElapsedSec(0);
    const t = window.setInterval(() => setElapsedSec((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  const steps: AiSaveStage[] = ["sending", "classifying", "saving"];
  const activeIdx = steps.indexOf(stage === "done" ? "saving" : stage);

  return createPortal(
    <div className="ai-save-progress-root" role="dialog" aria-modal="true" aria-busy="true">
      <div className="ai-save-progress-card">
        <div className="ai-save-progress-head">
          <Sparkles size={18} aria-hidden />
          <strong>กำลังจัดประเภทบัญชี</strong>
        </div>
        <div className="ai-save-progress-spinner" aria-hidden>
          <Loader2 size={36} className="photo-preview-spinner" />
        </div>
        <p className="ai-save-progress-stage">{STAGE_LABEL[stage]}</p>
        {detail ? <p className="ai-save-progress-detail">{detail}</p> : null}
        <ol className="ai-save-progress-steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={
                i < activeIdx ? "is-done" : i === activeIdx ? "is-active" : "is-pending"
              }
            >
              {STAGE_LABEL[s].replace("…", "")}
            </li>
          ))}
        </ol>
        <p className="ai-save-progress-elapsed" aria-live="polite">
          ใช้เวลา {elapsedSec} วินาที
        </p>
      </div>
    </div>,
    document.body,
  );
}
