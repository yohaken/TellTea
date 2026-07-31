/**
 * Document evidence policy for cash-out create (staff ledger + owner books + bill notice).
 *
 * Product choice: serious always-on notice + one acknowledge checkbox — NOT a second
 * VAT-style multi-step gate. Keep showing on every create (do not dismiss forever):
 * staff who misunderstand are exactly why the reminder must stay visible.
 *
 * Purchase: receipt / tax invoice / PO — not slip-only, not goods photo alone.
 * Staff-pay: transfer slip + chat is enough.
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
 * (เกิดขึ้นน้อย แต่พบบ่อยเมื่อพนักงานยังไม่เข้าใจกติกาเอกสาร)
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
  /** true when AI saw weak evidence on a purchase (escalate tone) */
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
      title: "โอนให้พนักงาน · หลักฐานที่ยอมรับได้",
      body: "กรณีโอนค่าแรง / ทดลองรายวัน / เบิกเข้าบัญชีพนักงาน — สลิปโอน + แชทยืนยันก็เพียงพอ (ไม่บังคับใบกำกับภาษี)",
      ackLabel: "เข้าใจแล้ว · มีสลิปและแชทตามนี้",
      escalate: false,
      weakKind: "none",
    };
  }

  if (weak === "slip_only") {
    return {
      policy,
      title: "พบสลิปโอนอย่างเดียว — ยังไม่พอสำหรับสรรพากร",
      body: "สลิปโอนอย่างเดียวไม่พอ — ต้องมีใบเสร็จ ใบกำกับภาษี หรือเช็ค/ใบสั่งสินค้าอย่างน้อยหนึ่งอย่าง · ถ่ายแค่สินค้าก็ไม่พอ สรรพากรเรียกตรวจได้",
      ackLabel: "เข้าใจแล้ว · จะแนบใบเสร็จ/ใบกำกับ ไม่ใช่แค่สลิป",
      escalate: true,
      weakKind: weak,
    };
  }

  if (weak === "goods_only") {
    return {
      policy,
      title: "พบแค่รูปสินค้า — ยังไม่มีเอกสารจ่าย",
      body: "ถ่ายสินค้า/ของที่ซื้ออย่างเดียวไม่พอ — ต้องมีใบเสร็จ ใบกำกับภาษี หรือเช็คสั่งสินค้า (สลิปโอนอย่างเดียวก็ยังไม่พอ) สรรพากรเรียกตรวจได้",
      ackLabel: "เข้าใจแล้ว · จะแนบใบเสร็จ/ใบกำกับ ไม่ใช่แค่รูปสินค้า",
      escalate: true,
      weakKind: weak,
    };
  }

  return {
    policy,
    title: "เอกสารหลักฐานรายการจ่าย",
    body: "รายการซื้อ/จ่ายต้องมีใบเสร็จ ใบกำกับภาษี หรือเช็คสั่งสินค้าอย่างน้อยหนึ่งอย่าง — ไม่ใช้สลิปโอนอย่างเดียว และถ่ายแค่สินค้าก็ไม่พอ เพราะสรรพากรเรียกตรวจได้",
    ackLabel: "เข้าใจแล้ว · มีเอกสารหลักฐานครบตามนี้",
    escalate: false,
    weakKind: "none",
  };
}

/**
 * Create cash-out always requires one ack (shared staff + owner).
 * Keep showing every create — do not “remember forever” / dismiss permanently.
 */
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
