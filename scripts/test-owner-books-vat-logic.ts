/**
 * Pure tests for purchase VAT helpers (AI-first, no silent 7/107).
 */
import assert from "node:assert/strict";
import {
  businessCostOut,
  normalizeAiVatExtract,
  normalizePurchaseVat,
  parseVatInputStr,
  proposePurchaseVatInput,
} from "../src/lib/entry-vat";
import {
  normalizeOwnerBookVat,
  proposeOwnerBookVatInput,
} from "../src/lib/owner-books";

assert.equal(proposePurchaseVatInput(107), 7);
assert.equal(proposeOwnerBookVatInput(107), 7);

{
  const off = normalizePurchaseVat({ hasVat: false }, 107);
  assert.equal(off.hasVat, false);
  assert.equal(off.vatInput, 0);
  assert.equal(off.vatVerified, false);
  assert.equal(off.vatClaim, false);
}

{
  // hasVat แต่ไม่มียอด → คง 0 (ไม่บังคับ ×7/107)
  const on = normalizePurchaseVat({ hasVat: true }, 107);
  assert.equal(on.hasVat, true);
  assert.equal(on.vatInput, 0);
  assert.equal(on.vatClaim, false);
}

{
  // ไม่มี vatClaim แต่มียอด → ยังไม่รวม (ต้องติ๊กที่ VAT เดือน)
  const legacy = normalizePurchaseVat(
    { hasVat: true, vatInput: 7, vatSource: "manual" },
    107,
  );
  assert.equal(legacy.vatClaim, false);
}

{
  // AI/รายการใหม่: ส่ง vatClaim=false ชัดเจน
  const fresh = normalizePurchaseVat(
    { hasVat: true, vatInput: 7, vatSource: "ai", vatClaim: false },
    107,
  );
  assert.equal(fresh.vatClaim, false);
}

{
  const custom = normalizeOwnerBookVat(
    {
      hasVat: true,
      vatInput: 5.5,
      vatInvoiceNo: " INV-1 ",
      vatSource: "ai",
      vatVerified: true,
      vatClaim: true,
    },
    107,
  );
  assert.equal(custom.vatInput, 5.5);
  assert.equal(custom.vatInvoiceNo, "INV-1");
  assert.equal(custom.vatSource, "ai");
  assert.equal(custom.vatVerified, true);
  assert.equal(custom.vatClaim, true);
}

assert.equal(parseVatInputStr(""), 0);
assert.equal(parseVatInputStr("12.5"), 12.5);

{
  const ai = normalizeAiVatExtract({
    hasVat: true,
    vatInput: 70,
    vatSeenOnBill: true,
    vatReason: "เห็นบรรทัด VAT",
  });
  assert.equal(ai.hasVat, true);
  assert.equal(ai.vatInput, 70);
  assert.equal(ai.vatSeenOnBill, true);
}

{
  // AI ไม่มีตัวเลข → ไม่ถือว่ามี VAT
  const ai = normalizeAiVatExtract({ hasVat: true, vatInput: null });
  assert.equal(ai.hasVat, false);
}

{
  // ต้นทุนบัญชี = เงินออก − ภาษีซื้อ (เงินสดยังรวม VAT)
  assert.equal(businessCostOut(107, true, 7), 100);
  assert.equal(businessCostOut(100, false, 0), 100);
  assert.equal(businessCostOut(107, true, 0), 107);
  assert.equal(businessCostOut(5, true, 7), 0);
  assert.equal(businessCostOut(0, true, 7), 0);
}

console.log("test-owner-books-vat-logic: ok");
