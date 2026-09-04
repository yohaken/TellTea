/**
 * ภ.พ.30 ข้อ 6 ยอดซื้อ = ภาษีซื้อ × 100/7 รายใบ — ไม่ใช้ยอดบิล
 */
import assert from "node:assert/strict";
import {
  bookVatsForPp30,
  buildPp30Filing,
  deriveMonthBooksView,
  emptyMonthBooksDraft,
  formatPp30CopyText,
  outputVatFromSalesInclusive,
  purchaseBaseFromVat,
  sumPurchaseBaseFromVatAmounts,
} from "../src/lib/vat-month-books";

assert.equal(outputVatFromSalesInclusive(221008), 15470.56);
assert.equal(outputVatFromSalesInclusive(10700), 749);
assert.equal(outputVatFromSalesInclusive(0), 0);

assert.equal(purchaseBaseFromVat(70), 1000);
assert.equal(purchaseBaseFromVat(7), 100);
assert.equal(purchaseBaseFromVat(0), 0);
assert.equal(purchaseBaseFromVat(4090.67), 58438.14);

{
  // บิลปนของไม่มีแวท: ยอดจ่าย 1,470 / VAT 70 → ยอดซื้อต้อง 1,000 ไม่ใช่ 1,400
  const bill = 1470;
  const vat = 70;
  assert.equal(purchaseBaseFromVat(vat), 1000);
  assert.notEqual(bill - vat, 1000);
  assert.equal(bill - vat, 1400);
}

{
  const perBill = sumPurchaseBaseFromVatAmounts([70, 7]);
  assert.equal(perBill, 1100);
}

{
  const claimed = [70, 7];
  assert.deepEqual(bookVatsForPp30(claimed, 77), claimed);
  assert.deepEqual(bookVatsForPp30(claimed, 80), [80]);
  assert.deepEqual(bookVatsForPp30([], 66.62), [66.62]);
  assert.deepEqual(bookVatsForPp30([], 0), []);
}

{
  const filing = buildPp30Filing({
    salesInclusive: 236471.07,
    salesExVat: 221001,
    outputVat: 15470.07,
    gpVats: [1508.91, 1804.16, 777.6],
    bookVats: [70],
    inputVat: 4160.67,
    includeInputVat: true,
  });
  assert.equal(filing.purchaseBaseGp, 58438.14);
  assert.equal(filing.purchaseBaseBooks, 1000);
  assert.equal(filing.purchaseBase, 59438.14);
  assert.equal(filing.inputVat, 4160.67);
}

{
  const off = buildPp30Filing({
    salesInclusive: 10700,
    salesExVat: 10000,
    outputVat: 700,
    gpVats: [7],
    bookVats: [7],
    inputVat: 14,
    includeInputVat: false,
  });
  assert.equal(off.purchaseBase, 0);
  assert.equal(off.inputVat, 0);
  assert.equal(off.outputVat, 700);
  assert.equal(off.netVat, 700);
}

{
  const text = formatPp30CopyText({
    salesInclusive: 10700,
    salesExVat: 10000,
    outputVat: 700,
    purchaseBaseGp: 100,
    purchaseBaseBooks: 100,
    purchaseBase: 200,
    inputVat: 14,
    netVat: 686,
  });
  assert.match(text, /ยอดขายรวม VAT\t10700.00/);
  assert.match(text, /ภาษีขาย ×7%\t700.00/);
  assert.match(text, /ยอดซื้อไม่รวม VAT\t200.00/);
  assert.match(text, /ภาษีซื้อ\t14.00/);
}

{
  const d = emptyMonthBooksDraft("2026-08");
  d.sales.shopee = 10700;
  d.gpFee.shopee = 1070;
  d.gpVatOverride.shopee = 70;
  const v = deriveMonthBooksView(d);
  assert.equal(v.outputVat, 749);
  assert.equal(v.salesExVat, 10000);
  assert.equal(v.gpVatByChannel.shopee, 70);
  assert.equal(v.inputGpVat, 70);
}

console.log("OK test-vat-pp30");
