"use client";

import { TypePicker } from "@/components/TypePicker";
import { labelLedgerType } from "@/lib/ledger-labels";
import type { LedgerTypeSource } from "@/lib/ledger-ai";
import { RefreshCw, Sparkles } from "lucide-react";

type Props = {
  isOwner: boolean;
  /**
   * deferred = พนักงาน — จัดตอนกดบันทึก ไม่รัน AI ตอนพิมพ์
   * live = เจ้าของพรีวิว / จัดใหม่ก่อนบันทึก
   */
  mode?: "deferred" | "live";
  /** ประเภทที่มีอยู่แล้ว (แก้ไข) หรือพรีวิวล่าสุด */
  displayType?: string;
  aiType: string;
  aiReason: string;
  aiSource: LedgerTypeSource;
  aiStatus: "idle" | "loading" | "ready" | "error";
  aiError: string | null;
  ownerLocked: boolean;
  typeMode: string;
  onTypeModeChange: (value: string) => void;
  onReclassify: () => void;
  frequent?: string[];
  id?: string;
};

/** พนักงาน: จัดตอนบันทึก · เจ้าของ: แก้ประเภท / จัดใหม่ล่วงหน้าได้ */
export function LedgerTypeField({
  isOwner,
  mode = isOwner ? "live" : "deferred",
  displayType,
  aiType,
  aiReason,
  aiSource,
  aiStatus,
  aiError,
  ownerLocked,
  typeMode,
  onTypeModeChange,
  onReclassify,
  frequent = [],
  id = "ledger-type",
}: Props) {
  const shown =
    displayType ||
    (ownerLocked && typeMode !== "auto" ? typeMode : aiType) ||
    "";
  const busy = aiStatus === "loading";

  if (!isOwner || mode === "deferred") {
    return (
      <div className="field ledger-type-ai-field" aria-live="polite">
        <label>ประเภทบัญชี</label>
        <div
          className="ledger-type-ai-card"
          title="ระบบจัดประเภทตอนกดบันทึก จากชื่อรายการ + โปรไฟล์กิจการ"
        >
          <div className="ledger-type-ai-head">
            <Sparkles size={14} aria-hidden />
            <span>จัดอัตโนมัติตอนบันทึก</span>
          </div>
          {shown ? (
            <p className="ledger-type-ai-value">{labelLedgerType(shown)}</p>
          ) : (
            <p className="ledger-type-ai-reason">ไม่ต้องเลือกเอง</p>
          )}
        </div>
      </div>
    );
  }

  const statusLabel =
    aiStatus === "loading"
      ? "กำลังจัดประเภท…"
      : aiStatus === "error"
        ? "ใช้ค่าสำรองจากชื่อรายการ"
        : aiSource === "ai"
          ? "จัดโดย AI"
          : aiSource === "owner"
            ? "กำหนดโดยเจ้าของ"
            : aiSource === "legacy"
              ? "ประเภทเดิมในระบบ"
              : "จัดจากชื่อรายการ";

  return (
    <div className="ledger-type-owner-wrap">
      <div className="ledger-type-ai-card is-owner">
        <div className="ledger-type-ai-head">
          <Sparkles size={14} aria-hidden />
          <span>{ownerLocked ? "แก้ประเภทเองแล้ว" : statusLabel}</span>
        </div>
        <p className="ledger-type-ai-value">
          {labelLedgerType(shown || aiType || "cogs")}
        </p>
        {aiReason && !ownerLocked ? (
          <p className="ledger-type-ai-reason" title={aiReason}>
            {aiReason}
          </p>
        ) : null}
        {aiError ? (
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
            {aiError}
          </p>
        ) : null}
        <button
          type="button"
          className="ghost-btn ledger-type-reset-ai"
          disabled={busy}
          onClick={onReclassify}
          title="จัดประเภทใหม่ด้วย AI (พรีวิว)"
        >
          <RefreshCw size={14} aria-hidden />
          {busy ? "กำลังจัดใหม่…" : "จัดใหม่ด้วย AI"}
        </button>
        {!ownerLocked ? (
          <p className="ledger-type-ai-hint">ไม่ล็อกเอง = จัดอีกครั้งตอนบันทึก</p>
        ) : null}
      </div>
      <TypePicker
        id={id}
        label="แก้ประเภท (เจ้าของ)"
        value={typeMode}
        onChange={onTypeModeChange}
        frequent={frequent}
        autoHint={aiType}
      />
    </div>
  );
}
