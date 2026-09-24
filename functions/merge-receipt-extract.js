/**
 * Merge per-image receipt extracts.
 * Staff often attach: (1) bank transfer slip + (2) tax invoice / Top World receipt.
 * VAT must come only from the tax invoice — never invent via ×7/107.
 *
 * utility_bill = ใบแจ้งค่าไฟ/ค่าน้ำ (ยอดเรียกเก็บ) — not a paid receipt.
 */

function normalizeDocKind(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  // Utility bill notice BEFORE generic "ใบเสร็จ" (MEA bills often print both words).
  if (
    s === "utility_bill" ||
    s === "utility" ||
    s.includes("utility_bill") ||
    s.includes("ใบแจ้งค่าไฟ") ||
    s.includes("ใบแจ้งค่าไฟฟ้า") ||
    s.includes("ค่าไฟฟ้า") ||
    s.includes("กฟน") ||
    s.includes("กฟภ") ||
    s.includes("การไฟฟ้า") ||
    s.includes("ใบแจ้งค่าน้ำ") ||
    s.includes("ค่าน้ำประปา") ||
    /\bmea\b/.test(s) ||
    /\bpea\b/.test(s)
  ) {
    return "utility_bill";
  }
  if (
    s === "tax_invoice" ||
    s === "tax" ||
    s === "receipt" ||
    s === "invoice" ||
    s.includes("ใบกำกับ") ||
    s.includes("ใบเสร็จ") ||
    s.includes("tax")
  ) {
    return "tax_invoice";
  }
  if (
    s === "bank_slip" ||
    s === "transfer" ||
    s === "slip" ||
    s === "promptpay" ||
    s.includes("สลิป") ||
    s.includes("โอน") ||
    s.includes("bank")
  ) {
    return "bank_slip";
  }
  return "other";
}

function hasVatAmount(row) {
  return Boolean(row && row.hasVat && row.vatInput != null && Number(row.vatInput) > 0);
}

/**
 * @param {Array<Record<string, unknown>>} results — one extract per image
 */
function mergeExtractResults(results) {
  const rows = (results || []).filter(Boolean);
  if (!rows.length) {
    throw new Error("ไม่มีผลอ่านจากรูป");
  }
  if (rows.length === 1) {
    const only = rows[0];
    return publicFields(only);
  }

  const taxOnes = rows.filter((r) => r.docKind === "tax_invoice");
  const bankOnes = rows.filter((r) => r.docKind === "bank_slip");
  const utilityOnes = rows.filter((r) => r.docKind === "utility_bill");
  const nonBank = rows.filter((r) => r.docKind !== "bank_slip");
  const withVat = rows.filter(hasVatAmount);

  const vatFrom =
    withVat.find((r) => r.docKind === "tax_invoice") || withVat[0] || null;

  // Prefer billed amount from utility notice over other documents when present.
  const amountFrom =
    utilityOnes.find((r) => r.amountOut != null) ||
    taxOnes.find((r) => r.amountOut != null) ||
    nonBank.find((r) => r.amountOut != null) ||
    rows.find((r) => r.amountOut != null) ||
    rows[0];

  const descFrom = utilityOnes[0] || taxOnes[0] || nonBank[0] || rows[0];
  const primary = vatFrom || descFrom || rows[0];

  let vatReason = "";
  if (vatFrom) {
    vatReason = String(vatFrom.vatReason || "");
  } else if (utilityOnes.length > 0) {
    vatReason = "ใบแจ้งค่าสาธารณูปโภค — ใช้ยอดเรียกเก็บ ไม่ใช่ใบกำกับ VAT";
  } else if (bankOnes.length > 0 && taxOnes.length === 0) {
    vatReason = "มีสลิปโอน — ยังไม่พบบรรทัดภาษีบนใบกำกับ";
  } else {
    vatReason =
      String(primary.vatReason || "") ||
      "ไม่พบบรรทัดภาษีมูลค่าเพิ่มบนใบเสร็จ";
  }

  const slipOnly =
    bankOnes.length > 0 &&
    taxOnes.length === 0 &&
    utilityOnes.length === 0 &&
    !vatFrom;
  const goodsOnly =
    !slipOnly &&
    taxOnes.length === 0 &&
    utilityOnes.length === 0 &&
    !vatFrom &&
    bankOnes.length === 0 &&
    rows.every((r) => String(r.docKind || "other") === "other");

  return {
    date: String(descFrom.date || amountFrom.date || primary.date || ""),
    description: String(descFrom.description || primary.description || ""),
    amountOut: amountFrom.amountOut ?? primary.amountOut ?? null,
    type: String(
      utilityOnes.length
        ? "sga"
        : descFrom.type || primary.type || "อื่นๆ",
    ),
    note: String(descFrom.note || primary.note || ""),
    reason: String(descFrom.reason || primary.reason || ""),
    hasVat: Boolean(vatFrom),
    vatInput: vatFrom ? vatFrom.vatInput : null,
    vatBase: vatFrom ? vatFrom.vatBase ?? null : null,
    vatInvoiceNo: vatFrom ? String(vatFrom.vatInvoiceNo || "") : "",
    vatSeenOnBill: Boolean(vatFrom && vatFrom.vatSeenOnBill),
    vatReason: vatReason.slice(0, 80),
    docKind: slipOnly
      ? "bank_slip"
      : utilityOnes.length
        ? "utility_bill"
        : taxOnes.length
          ? "tax_invoice"
          : String(primary.docKind || "other"),
    slipOnly,
    goodsOnly,
  };
}

function publicFields(row) {
  const docKind = String(row.docKind || "other");
  const hasVat = Boolean(row.hasVat && row.vatInput != null);
  const slipOnly = docKind === "bank_slip";
  const goodsOnly = docKind === "other" && !hasVat;
  return {
    date: String(row.date || ""),
    description: String(row.description || ""),
    amountOut: row.amountOut ?? null,
    type: String(row.type || "อื่นๆ"),
    note: String(row.note || ""),
    reason: String(row.reason || ""),
    hasVat: docKind === "utility_bill" ? false : hasVat,
    vatInput: docKind === "utility_bill" ? null : row.vatInput ?? null,
    vatBase: docKind === "utility_bill" ? null : row.vatBase ?? null,
    vatInvoiceNo: docKind === "utility_bill" ? "" : String(row.vatInvoiceNo || ""),
    vatSeenOnBill:
      docKind === "utility_bill" ? false : Boolean(row.vatSeenOnBill && row.vatInput != null),
    vatReason: String(row.vatReason || "").slice(0, 80),
    docKind,
    slipOnly,
    goodsOnly,
  };
}

module.exports = {
  normalizeDocKind,
  mergeExtractResults,
  hasVatAmount,
};
