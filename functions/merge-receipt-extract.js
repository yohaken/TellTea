/**
 * Merge per-image receipt extracts.
 * Staff often attach: (1) bank transfer slip + (2) tax invoice / Top World receipt.
 * VAT must come only from the tax invoice — never invent via ×7/107.
 */

function normalizeDocKind(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
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
  const nonBank = rows.filter((r) => r.docKind !== "bank_slip");
  const withVat = rows.filter(hasVatAmount);

  const vatFrom =
    withVat.find((r) => r.docKind === "tax_invoice") || withVat[0] || null;

  const amountFrom =
    taxOnes.find((r) => r.amountOut != null) ||
    nonBank.find((r) => r.amountOut != null) ||
    rows.find((r) => r.amountOut != null) ||
    rows[0];

  const descFrom = taxOnes[0] || nonBank[0] || rows[0];
  const primary = vatFrom || descFrom || rows[0];

  let vatReason = "";
  if (vatFrom) {
    vatReason = String(vatFrom.vatReason || "");
  } else if (bankOnes.length > 0 && taxOnes.length === 0) {
    vatReason = "มีสลิปโอน — ยังไม่พบบรรทัดภาษีบนใบกำกับ";
  } else {
    vatReason =
      String(primary.vatReason || "") ||
      "ไม่พบบรรทัดภาษีมูลค่าเพิ่มบนใบเสร็จ";
  }

  const slipOnly = bankOnes.length > 0 && taxOnes.length === 0 && !vatFrom;

  return {
    date: String(descFrom.date || amountFrom.date || primary.date || ""),
    description: String(descFrom.description || primary.description || ""),
    amountOut: amountFrom.amountOut ?? primary.amountOut ?? null,
    type: String(descFrom.type || primary.type || "อื่นๆ"),
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
      : taxOnes.length
        ? "tax_invoice"
        : String(primary.docKind || "other"),
    slipOnly,
  };
}

function publicFields(row) {
  const docKind = String(row.docKind || "other");
  const slipOnly = docKind === "bank_slip";
  return {
    date: String(row.date || ""),
    description: String(row.description || ""),
    amountOut: row.amountOut ?? null,
    type: String(row.type || "อื่นๆ"),
    note: String(row.note || ""),
    reason: String(row.reason || ""),
    hasVat: Boolean(row.hasVat && row.vatInput != null),
    vatInput: row.vatInput ?? null,
    vatBase: row.vatBase ?? null,
    vatInvoiceNo: String(row.vatInvoiceNo || ""),
    vatSeenOnBill: Boolean(row.vatSeenOnBill && row.vatInput != null),
    vatReason: String(row.vatReason || "").slice(0, 80),
    docKind,
    slipOnly,
  };
}

module.exports = {
  normalizeDocKind,
  mergeExtractResults,
  hasVatAmount,
};
