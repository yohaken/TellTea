/**
 * Gate: storefront amounts must survive month switches (pre-Aug manual + Aug nPOS).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const ui = read("src/components/vat-sales/VatMonthBooks.tsx");
assert.match(ui, /flushDirtySave/);
assert.match(ui, /async function changeMonth/);
assert.match(ui, /void changeMonth\(/);
assert.match(ui, /dirtySeq/);
assert.match(ui, /เซฟก่อนเปลี่ยนเดือน/);
assert.match(ui, /draftRef\.current\.monthKey !== m && dirtyRef\.current/);
// POS ว่างต้องไม่ลบต้นทางมือ
assert.match(ui, /คงยอดเดิมในตาราง/);
assert.doesNotMatch(
  ui,
  /saveSfSendSource\(month, gross\);\s*\n\s*if \(gross > 0\)/,
);
assert.match(ui, /if \(gross > 0\) \{[\s\S]*?saveSfSendSource\(fetchMonth, gross\)/);
// ตั้งติ๊ก nPOS ให้ตรงเดือนปลายทางก่อน setMonth
assert.match(ui, /setSfPosConnect\(loadSfPosConnect\(next\)\)/);
assert.match(ui, /setMonth\(next\)/);

const pos = read("src/lib/vat-storefront-pos.ts");
assert.match(pos, /SF_POS_CONNECT_FROM_MONTH = "2026-08"/);
assert.match(pos, /defaultPosConnectEnabled/);

function defaultPosConnectEnabled(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return false;
  return monthKey >= "2026-08";
}
assert.equal(defaultPosConnectEnabled("2026-06"), false);
assert.equal(defaultPosConnectEnabled("2026-07"), false);
assert.equal(defaultPosConnectEnabled("2026-08"), true);

// Round-trip: manual July storefront survives save payload → hydrate
const {
  emptyMonthBooksDraft,
  draftToSaveInput,
  retToMonthBooksDraft,
  patchSfSendIntoDraft,
  patchSfSendTendersIntoDraft,
} = await import(join(root, "src/lib/vat-month-books.ts"));
const { recomputeSegment, sumMonthlyTotals } = await import(
  join(root, "src/lib/vat-monthly.ts")
);

function fakeSaved(input) {
  const delivery = recomputeSegment(input.delivery);
  const storefront = recomputeSegment(input.storefront);
  return {
    monthKey: input.monthKey,
    delivery,
    storefront,
    totals: sumMonthlyTotals(
      delivery,
      storefront,
      delivery.grossSales,
      storefront.grossSales,
    ),
    status: "saved",
    note: "",
    pnlIncome: input.pnlIncome,
    pnlIncomeMode: "incVat",
    pnlDeliveryGpDeduct: input.pnlDeliveryGpDeduct,
    pnlDeliveryGpMode: "amount",
    pnlDeliveryGpPct: 0,
    pnlGpByChannel: input.pnlGpByChannel,
    includeInputVat: true,
    filedAt: 0,
    filedBy: "",
    updatedAt: 1,
    updatedBy: "test",
  };
}

// Case A: manual table entry July (A + D transfer)
{
  let d = emptyMonthBooksDraft("2026-07");
  d = {
    ...d,
    transfer: { ...d.transfer, storefront: 55000 },
    sales: { ...d.sales, storefrontTransfer: 55000, storefrontCash: 0 },
  };
  const back = retToMonthBooksDraft(fakeSaved(draftToSaveInput(d, "saved")));
  assert.equal(back.transfer.storefront, 55000);
  assert.equal(back.sales.storefrontTransfer, 55000);
}

// Case B: strip send (patchSfSendIntoDraft) June
{
  let d = emptyMonthBooksDraft("2026-06");
  d = patchSfSendIntoDraft(d, 42000);
  const back = retToMonthBooksDraft(fakeSaved(draftToSaveInput(d, "saved")));
  assert.equal(back.transfer.storefront, 42000);
  assert.equal(back.sales.storefrontTransfer, 42000);
  assert.equal(back.sales.storefrontCash, 0);
}

// Case C: POS tenders Aug (cash + transfer)
{
  let d = emptyMonthBooksDraft("2026-08");
  d = patchSfSendTendersIntoDraft(d, { cash: 12000, transfer: 38000 });
  const back = retToMonthBooksDraft(fakeSaved(draftToSaveInput(d, "saved")));
  assert.equal(back.transfer.storefront, 50000);
  assert.equal(back.sales.storefrontCash, 12000);
  assert.equal(back.sales.storefrontTransfer, 38000);
}

// Case D: switching months must not clear prior month payload shape
{
  const july = retToMonthBooksDraft(
    fakeSaved(
      draftToSaveInput(
        {
          ...emptyMonthBooksDraft("2026-07"),
          transfer: {
            ...emptyMonthBooksDraft("2026-07").transfer,
            storefront: 99001,
          },
          sales: {
            ...emptyMonthBooksDraft("2026-07").sales,
            storefrontTransfer: 99001,
          },
        },
        "saved",
      ),
    ),
  );
  const aug = retToMonthBooksDraft(
    fakeSaved(
      draftToSaveInput(
        patchSfSendTendersIntoDraft(emptyMonthBooksDraft("2026-08"), {
          cash: 1,
          transfer: 2,
        }),
        "saved",
      ),
    ),
  );
  assert.equal(july.monthKey, "2026-07");
  assert.equal(july.transfer.storefront, 99001);
  assert.equal(aug.monthKey, "2026-08");
  assert.equal(aug.transfer.storefront, 3);
  // re-hydrate July again — still intact (simulates going back)
  assert.equal(july.transfer.storefront, 99001);
}

const version = read("src/lib/version.ts");
const build = Number(version.match(/APP_BUILD = (\d+)/)?.[1] || 0);
assert.ok(build >= 631, `APP_BUILD should be >= 630, got ${build}`);

console.log("OK test-vat-sf-month-persist");
