"use client";

import { TypePicker } from "@/components/TypePicker";
import { labelLedgerType } from "@/lib/ledger-labels";
import type { LedgerTypeSource } from "@/lib/ledger-ai";
import { RefreshCw, Sparkles } from "lucide-react";

type Props = {
  isOwner: boolean;
  /** พนักงาน/โหมด AI — ค่าจาก hook */
  aiType: string;
  aiReason: string;
  aiSource: LedgerTypeSource;
  aiStatus: "idle" | "loading" | "ready" | "error";
  aiError: string | null;
  usedImages?: number;
  /** เจ้าของล็อกแก้ประเภทเอง */
  ownerLocked: boolean;
  typeMode: string;
  onTypeModeChange: (value: string) => void;
  /** บังคับให้ AI จัดใหม่จากชื่อ (+ รูป) แม้มีประเภทอยู่แล้ว */
  onReclassify: () => void;
  frequent?: string[];
  id?: string;
};

/** พนักงาน: แสดงผล AI อย่างเดียว · เจ้าของ: แก้ประเภทได้ */
export function LedgerTypeField({
  isOwner,
  aiType,
  aiReason,
  aiSource,
  aiStatus,
  aiError,
  usedImages = 0,
  ownerLocked,
  typeMode,
  onTypeModeChange,
  onReclassify,
  frequent = [],
  id = "ledger-type",
}: Props) {
  const displayType = ownerLocked && typeMode !== "auto" ? typeMode : aiType;
  const hasType = Boolean(String(displayType || "").trim());
  const busy = aiStatus === "loading";
  const showReclassify = hasType && aiStatus !== "idle";

  const statusLabel =
    aiStatus === "loading"
      ? "กำลังจัดประเภท…"
      : aiStatus === "error"
        ? "ใช้ค่าสำรองจากชื่อรายการ"
        : aiSource === "ai"
          ? usedImages > 0
            ? `จัดประเภทบัญชีโดย AI · ใช้รูป ${usedImages}`
            : "จัดประเภทบัญชีโดย AI"
          : aiSource === "owner"
            ? "กำหนดโดยเจ้าของ"
            : aiSource === "legacy"
              ? "ประเภทเดิมในระบบ (ยังไม่ผ่าน AI)"
              : "จัดจากชื่อรายการ";

  const reclassifyBtn = showReclassify ? (
    <button
      type="button"
      className="ghost-btn ledger-type-reset-ai"
      disabled={busy}
      onClick={onReclassify}
    >
      <RefreshCw size={14} aria-hidden />
      {busy ? "กำลังจัดใหม่…" : "จัดประเภทใหม่ด้วย AI"}
    </button>
  ) : null;

  if (!isOwner) {
    return (
      <div className="field ledger-type-ai-field" aria-live="polite">
        <label>ประเภทบัญชี</label>
        <div className="ledger-type-ai-card">
          <div className="ledger-type-ai-head">
            <Sparkles size={14} aria-hidden />
            <span>{statusLabel}</span>
          </div>
          <p className="ledger-type-ai-value">
            {aiStatus === "idle" && !displayType
              ? "พิมพ์ชื่อรายการแล้วระบบจะจัดให้"
              : labelLedgerType(displayType || "cogs")}
          </p>
          {aiReason ? <p className="ledger-type-ai-reason">{aiReason}</p> : null}
          {aiStatus === "ready" && aiSource === "ai" && usedImages === 0 ? (
            <p className="ledger-type-ai-hint">
              แนบรูปสินค้า/ใบเสร็จช่วยให้จัดประเภทแม่นขึ้นเมื่อชื่อสั้น
            </p>
          ) : null}
          {aiError ? (
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
              {aiError}
            </p>
          ) : null}
          {reclassifyBtn}
        </div>
      </div>
    );
  }

  return (
    <div className="ledger-type-owner-wrap">
      <div className="ledger-type-ai-card is-owner">
        <div className="ledger-type-ai-head">
          <Sparkles size={14} aria-hidden />
          <span>{ownerLocked ? "คุณแก้ประเภทเองแล้ว" : statusLabel}</span>
        </div>
        <p className="ledger-type-ai-value">{labelLedgerType(displayType || "cogs")}</p>
        {aiReason && !ownerLocked ? (
          <p className="ledger-type-ai-reason">{aiReason}</p>
        ) : null}
        {!ownerLocked && aiStatus === "ready" && aiSource === "ai" && usedImages === 0 ? (
          <p className="ledger-type-ai-hint">
            แนบรูปสินค้า/ใบเสร็จช่วยให้จัดประเภทแม่นขึ้นเมื่อชื่อสั้น
          </p>
        ) : null}
        {reclassifyBtn}
      </div>
      <TypePicker
        id={id}
        label="แก้ประเภท (เจ้าของเท่านั้น)"
        value={typeMode}
        onChange={onTypeModeChange}
        frequent={frequent}
        autoHint={aiType}
      />
    </div>
  );
}
