/**
 * ยอดหน้าร้านที่เซฟแล้วต้องโหลดกลับได้ · ไม่ถูก fallback เป็นยอดขาย
 */
import assert from "node:assert/strict";
import {
  draftToSaveInput,
  emptyMonthBooksDraft,
  patchSfSendIntoDraft,
  patchTransfer,
  retToMonthBooksDraft,
} from "../src/lib/vat-month-books";
import type { VatMonthlyReturn } from "../src/lib/vat-monthly";
import { recomputeSegment, sumMonthlyTotals } from "../src/lib/vat-monthly";

function minimalReturn(partial: {
  sfNet: number;
  sfSalesTransfer: number;
  sfSalesCash?: number;
}): VatMonthlyReturn {
  const delivery = recomputeSegment({
    kind: "delivery",
    grossManual: 0,
    channels: { shopee: 0, grab: 0, lineman: 0 },
    tenders: { cash: 0, transfer: 0, other: 0 },
    remitPct: 100,
    gpVat: 0,
    useGpEstimate: false,
    ingredientVat: 0,
  });
  const storefront = recomputeSegment({
    kind: "storefront",
    grossManual: 0,
    channels: { shopee: 0, grab: 0, lineman: 0 },
    tenders: {
      cash: partial.sfSalesCash || 0,
      transfer: partial.sfSalesTransfer,
      other: 0,
    },
    remitPct: 100,
    gpVat: 0,
    useGpEstimate: false,
    ingredientVat: 0,
  });
  const totals = sumMonthlyTotals(
    delivery,
    storefront,
    delivery.grossSales,
    storefront.grossSales,
  );
  return {
    monthKey: "2026-07",
    status: "saved",
    note: "",
    delivery,
    storefront,
    totals,
    pnlIncomeMode: "incVat",
    pnlIncome: partial.sfNet,
    pnlDeliveryGpDeduct: 0,
    pnlDeliveryGpMode: "amount",
    pnlDeliveryGpPct: 0,
    pnlGpByChannel: {
      shopee: {
        mode: "transfer",
        pct: 0,
        amount: 0,
        netTransfer: 0,
        gpVatOverride: 0,
      },
      grab: {
        mode: "transfer",
        pct: 0,
        amount: 0,
        netTransfer: 0,
        gpVatOverride: 0,
      },
      lineman: {
        mode: "transfer",
        pct: 0,
        amount: 0,
        netTransfer: 0,
        gpVatOverride: 0,
      },
      storefront: {
        mode: "transfer",
        pct: 0,
        amount: 0,
        netTransfer: partial.sfNet,
        gpVatOverride: 0,
      },
    },
    includeInputVat: true,
    filedAt: 0,
    filedBy: "",
    updatedAt: 1,
    updatedBy: "t",
    createdAt: 1,
    createdBy: "t",
  } as VatMonthlyReturn;
}

// เซฟยอดหน้าร้าน 50,000 แม้ยอดขายโอนเป็นคนละจำนวน — ต้องจำ 50,000
const ret = minimalReturn({ sfNet: 50_000, sfSalesTransfer: 80_000 });
const draft = retToMonthBooksDraft(ret);
assert.equal(draft.transfer.storefront, 50_000);
assert.equal(draft.sales.storefrontTransfer, 80_000);

// round-trip ผ่าน draftToSaveInput โครง gp
let d = emptyMonthBooksDraft("2026-07");
d = patchTransfer(d, "storefront", 42_500);
const save = draftToSaveInput(d, "saved");
assert.equal(save.pnlGpByChannel?.storefront?.netTransfer, 42_500);
assert.equal(save.pnlGpByChannel?.storefront?.mode, "transfer");

// แถบส่งตั้งยอดแล้ว — hydrate กลับต้องเท่าเดิม
d = patchSfSendIntoDraft(emptyMonthBooksDraft("2026-07"), 33_000);
assert.equal(d.transfer.storefront, 33_000);
assert.equal(d.sales.storefrontTransfer, 33_000);

console.log("test-vat-storefront-remember: ok");
