/**
 * Pure helpers: fill VAT fields from amounts already read on a Thai receipt.
 * Does NOT invent VAT via ×7/107 when only the gross total is known.
 */

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * When the model reads vatBase (ฐานภาษี) + amountOut (ยอดรวม) but misses vatInput,
 * derive VAT as gross − base — only if it matches ~7% of the base (Top World layout).
 */
function fillVatFromBaseAndGross(vat, amountOut) {
  const base = vat?.vatBase;
  const input = vat?.vatInput;
  const gross = amountOut;
  if (input != null && input > 0) return vat;
  if (base == null || !(base > 0) || gross == null || !(gross > 0)) return vat;
  if (gross <= base) return vat;

  const derived = roundMoney(gross - base);
  if (!(derived > 0)) return vat;

  const expected = roundMoney(base * 0.07);
  const tol = Math.max(0.05, roundMoney(expected * 0.02));
  if (Math.abs(derived - expected) > tol) return vat;

  return {
    ...vat,
    hasVat: true,
    vatInput: derived,
    vatBase: roundMoney(base),
    vatSeenOnBill: true,
    vatReason:
      String(vat?.vatReason || "").trim() ||
      "จากฐานภาษี+ยอดรวมบนบิล (ท้ายใบเสร็จ)",
  };
}

/**
 * When vatInput + amountOut are known but vatBase is missing.
 */
function fillVatBaseFromGrossAndInput(vat, amountOut) {
  const input = vat?.vatInput;
  const base = vat?.vatBase;
  const gross = amountOut;
  if (base != null && base > 0) return vat;
  if (input == null || !(input > 0) || gross == null || !(gross > 0)) return vat;
  if (gross <= input) return vat;
  return {
    ...vat,
    vatBase: roundMoney(gross - input),
  };
}

function completeVatFromBill(vat, amountOut) {
  let next = fillVatFromBaseAndGross(vat, amountOut);
  next = fillVatBaseFromGrossAndInput(next, amountOut);
  return next;
}

module.exports = {
  fillVatFromBaseAndGross,
  fillVatBaseFromGrossAndInput,
  completeVatFromBill,
  roundMoney,
};
