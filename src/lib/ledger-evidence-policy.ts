/**
 * Document evidence policy for cash-out create (staff ledger + owner books + bill notice).
 *
 * Product choice: serious always-on notice + one acknowledge checkbox — NOT a second
 * VAT-style multi-step gate. Most staff already attach proper docs (≈80–90%); we still
 * force an explicit read so tax-audit rules stay visible. Staff-pay transfers use a
 * lighter rule (slip + chat).
 */

export type EvidenceDocPolicy = "purchase" | "staff_transfer";

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

export type EvidenceNoticeCopy = {
  policy: EvidenceDocPolicy;
  title: string;
  body: string;
  ackLabel: string;
  /** true when AI saw slip-only and this is a purchase (escalate tone) */
  escalate: boolean;
};

export function evidenceNoticeCopy(opts: {
  description: string;
  slipOnly?: boolean;
  vatReason?: string;
  docKind?: string;
}): EvidenceNoticeCopy {
  const policy = evidenceDocPolicy(opts.description);
  const slipOnly =
    policy === "purchase" &&
    isSlipOnlySignal({
      slipOnly: opts.slipOnly,
      vatReason: opts.vatReason,
      docKind: opts.docKind,
    });

  if (policy === "staff_transfer") {
    return {
      policy,
      title: "โอนให้พนักงาน · หลักฐานที่ยอมรับได้",
      body: "กรณีโอนค่าแรง / ทดลองรายวัน / เบิกเข้าบัญชีพนักงาน — สลิปโอน + แชทยืนยันก็เพียงพอ (ไม่บังคับใบกำกับภาษี)",
      ackLabel: "เข้าใจแล้ว · มีสลิปและแชทตามนี้",
      escalate: false,
    };
  }

  return {
    policy,
    title: slipOnly
      ? "พบสลิปโอนอย่างเดียว — ยังไม่พอสำหรับสรรพากร"
      : "เอกสารหลักฐานรายการจ่าย",
    body: slipOnly
      ? "สลิปโอนอย่างเดียวไม่พอ — ต้องมีใบเสร็จ ใบกำกับภาษี หรือเช็ค/ใบสั่งสินค้าอย่างน้อยหนึ่งอย่าง สรรพากรเรียกตรวจได้ · แนบเอกสารเพิ่มก่อนบันทึก"
      : "รายการซื้อ/จ่ายต้องมีใบเสร็จ ใบกำกับภาษี หรือเช็คสั่งสินค้าอย่างน้อยหนึ่งอย่าง — ไม่ใช้สลิปโอนเพียงอย่างเดียว เพราะสรรพากรเรียกตรวจได้",
    ackLabel: slipOnly
      ? "เข้าใจแล้ว · จะแนบใบเสร็จ/ใบกำกับ ไม่ใช่แค่สลิป"
      : "เข้าใจแล้ว · มีเอกสารหลักฐานครบตามนี้",
    escalate: slipOnly,
  };
}

/** Create cash-out always requires one ack (shared staff + owner). */
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
