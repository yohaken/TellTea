/**
 * Document evidence policy for cash-out create (staff ledger + owner books + bill notice).
 *
 * Always-on inline notice + one ack (not a VAT-style multi-step / not a popup).
 * Purchase: receipt / tax invoice / PO preferred; chat screenshot OK if none.
 * Not enough alone: transfer slip only, or goods photo only.
 * Staff-pay: slip + chat.
 */

export type EvidenceDocPolicy = "purchase" | "staff_transfer";

/** Weak evidence kinds that escalate the notice (purchase only). */
export type EvidenceWeakKind = "none" | "slip_only" | "goods_only";

/** ค่าแรง / โอนเข้าบัญชีพนักงาน / ทดลองงาน — สลิป + แชทก็พอ */
const STAFF_TRANSFER_HINTS = [
  "ค่าแรง",
  "ค่าจ้าง",
  "เงินเดือน",
  "โบนัส",
  "ทดลองงาน",
  "ทดลองรายวัน",
  "รายวัน",
  "เบิกล่วงหน้า",
  "เบิกเงิน",
  "โอนให้พนักงาน",
  "โอนพนักงาน",
  "โอนเข้าบัญชีพนักงาน",
  "จ่ายพนักงาน",
  "ค่าแรงทดลอง",
  "ot พนักงาน",
  "โอทีพนักงาน",
] as const;

/** Informal sellers with no paper bill (e.g. farm coffee beans via chat). */
export const EVIDENCE_CHAT_FALLBACK = "ไม่มีบิลจริงๆ → แคปแชท/หน้าสั่งซื้อได้";

export function isStaffTransferDescription(description: string): boolean {
  const text = String(description || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!text) return false;
  return STAFF_TRANSFER_HINTS.some((h) => text.includes(h.replace(/\s+/g, "").toLowerCase()));
}

export function evidenceDocPolicy(description: string): EvidenceDocPolicy {
  return isStaffTransferDescription(description) ? "staff_transfer" : "purchase";
}

/** AI / merge สัญญาณว่ามีแต่สลิปโอน — ยังไม่มีใบกำกับ/ใบเสร็จ */
export function isSlipOnlySignal(opts: {
  vatReason?: string;
  slipOnly?: boolean;
  docKind?: string;
}): boolean {
  if (opts.slipOnly === true) return true;
  if (String(opts.docKind || "").toLowerCase() === "bank_slip") return true;
  const reason = String(opts.vatReason || "");
  return /สลิป/.test(reason) && !/ใบกำกับ|ใบเสร็จ|tax\s*invoice/i.test(reason);
}

/**
 * มีแต่รูปสินค้า / แพ็กกิ้ง — ไม่มีใบเสร็จ ใบกำกับ หรือสลิป
 */
export function isGoodsOnlySignal(opts: {
  goodsOnly?: boolean;
  vatReason?: string;
  reason?: string;
  docKind?: string;
  hasVat?: boolean;
}): boolean {
  if (opts.goodsOnly === true) return true;
  if (opts.hasVat === true) return false;
  const kind = String(opts.docKind || "").toLowerCase();
  if (kind === "tax_invoice" || kind === "bank_slip") return false;
  if (kind === "other") return true;
  const blob = `${opts.vatReason || ""} ${opts.reason || ""}`;
  return (
    /แพ็กกิ้ง|รายการสินค้า|ถ่ายสินค้า|สินค้าอย่างเดียว|รูปสินค้า/i.test(blob) &&
    !/ใบกำกับ|ใบเสร็จ|tax\s*invoice|สลิป/i.test(blob)
  );
}

export function evidenceWeakKind(opts: {
  slipOnly?: boolean;
  goodsOnly?: boolean;
  vatReason?: string;
  reason?: string;
  docKind?: string;
  hasVat?: boolean;
}): EvidenceWeakKind {
  if (
    isSlipOnlySignal({
      slipOnly: opts.slipOnly,
      vatReason: opts.vatReason,
      docKind: opts.docKind,
    })
  ) {
    return "slip_only";
  }
  if (
    isGoodsOnlySignal({
      goodsOnly: opts.goodsOnly,
      vatReason: opts.vatReason,
      reason: opts.reason,
      docKind: opts.docKind,
      hasVat: opts.hasVat,
    })
  ) {
    return "goods_only";
  }
  return "none";
}

export type EvidenceNoticeCopy = {
  policy: EvidenceDocPolicy;
  title: string;
  body: string;
  ackLabel: string;
  escalate: boolean;
  weakKind: EvidenceWeakKind;
};

export function evidenceNoticeCopy(opts: {
  description: string;
  slipOnly?: boolean;
  goodsOnly?: boolean;
  vatReason?: string;
  reason?: string;
  docKind?: string;
  hasVat?: boolean;
}): EvidenceNoticeCopy {
  const policy = evidenceDocPolicy(opts.description);
  const weak =
    policy === "purchase"
      ? evidenceWeakKind({
          slipOnly: opts.slipOnly,
          goodsOnly: opts.goodsOnly,
          vatReason: opts.vatReason,
          reason: opts.reason,
          docKind: opts.docKind,
          hasVat: opts.hasVat,
        })
      : "none";

  if (policy === "staff_transfer") {
    return {
      policy,
      title: "โอนพนักงาน · หลักฐาน",
      body: "ค่าแรง / ทดลอง / เบิก — สลิปโอน + แคปแชทก็พอ",
      ackLabel: "เข้าใจแล้ว · มีสลิปและแชท",
      escalate: false,
      weakKind: "none",
    };
  }

  if (weak === "slip_only") {
    return {
      policy,
      title: "มีแค่สลิปโอน — ยังไม่พอ",
      body: `ต้องมีใบเสร็จ/ใบกำกับ หรือเช็คสั่ง · ${EVIDENCE_CHAT_FALLBACK}`,
      ackLabel: "เข้าใจแล้ว · จะแนบบิลหรือแคปแชท",
      escalate: true,
      weakKind: weak,
    };
  }

  if (weak === "goods_only") {
    return {
      policy,
      title: "มีแค่รูปสินค้า — ยังไม่พอ",
      body: `ต้องมีใบเสร็จ/ใบกำกับ หรือเช็คสั่ง · ${EVIDENCE_CHAT_FALLBACK}`,
      ackLabel: "เข้าใจแล้ว · จะแนบบิลหรือแคปแชท",
      escalate: true,
      weakKind: weak,
    };
  }

  return {
    policy,
    title: "หลักฐานรายการจ่าย",
    body: `ใบเสร็จ / ใบกำกับ / เช็คสั่ง — ไม่ใช่แค่สลิปหรือรูปสินค้า · ${EVIDENCE_CHAT_FALLBACK}`,
    ackLabel: "เข้าใจแล้ว · มีบิลหรือแคปแชทแล้ว",
    escalate: false,
    weakKind: "none",
  };
}

/** Create cash-out always requires one ack every time (never dismiss forever). */
export function evidenceAckRequired(_opts?: { isCreate?: boolean }): boolean {
  return true;
}

export function evidenceReadyToSave(opts: {
  required: boolean;
  acked: boolean;
}): boolean {
  if (!opts.required) return true;
  return opts.acked === true;
}
