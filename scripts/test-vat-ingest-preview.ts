import assert from "node:assert/strict";
import {
  identifyIngestSource,
  previewIngestText,
} from "../src/lib/vat-ingest-preview";
import { parseShopeeMonthlyMail } from "../src/lib/vat-import-shopee-monthly-mail";
import { parseLinemanReportCsv } from "../src/lib/vat-import-lineman-report-csv";

const grabCsv = `วันที่,ยอดขายสุทธิ,ค่าคอมมิชชันแพลตฟอร์ม,ทั้งหมด,ภาษีค่าคอมมิชชัน, การปรับรายได้, โฆษณา GrabFood / GrabMart
01/07/2026,1000.00,-300.00,700.00,-19.63
02/07/2026,500.00,-150.00,350.00,-9.81
`;

assert.equal(
  identifyIngestSource("Transaction_Stores_2026-07-01.csv", grabCsv),
  "grab-stores-summary-reject",
);
assert.equal(
  identifyIngestSource("Transaction_Store_2026-07-01_to_2026-07-31.csv", grabCsv),
  "grab-transaction-csv",
);

const grab = previewIngestText(grabCsv, {
  fileName: "Transaction_Store_2026-07-01_to_2026-07-31.csv",
});
assert.equal(grab.kind, "grab-transaction-csv");
assert.equal(grab.channel, "grab");
assert.equal(grab.monthKey, "2026-07");
assert.equal(grab.ok, true);
assert.equal(grab.amounts?.sales, 1500);
assert.equal(grab.amounts?.transfer, 1050);
assert.equal(grab.amounts?.fee, 450);
assert.ok((grab.amounts?.gpVat || 0) > 0);

const reject = previewIngestText(grabCsv, {
  fileName: "Transaction_Stores_x.csv",
});
assert.equal(reject.kind, "grab-stores-summary-reject");
assert.equal(reject.ok, false);

const lmCsv = `summary_date,total_revenue,gp_fee_with_vat,payout
2026-05-01,1000.00,320.00,680.00
2026-05-02,500.00,160.00,340.00
`;
assert.equal(identifyIngestSource("REPORT_MAY26.csv", lmCsv), "lineman-report-csv");
const lm = parseLinemanReportCsv(lmCsv);
assert.equal(lm.monthKey, "2026-05");
assert.equal(lm.sales, 1500);
assert.equal(lm.feeInclVat, 480);
assert.equal(lm.transfer, 1020);
assert.ok(lm.gpVat > 0);

const lmPrev = previewIngestText(lmCsv, { fileName: "REPORT_MAY26.csv" });
assert.equal(lmPrev.channel, "lineman");
assert.equal(lmPrev.amounts?.fee, 480);

const sfMail = `
Kongsi Tea Bar รายงานการโอนเงินสำหรับ ShopeeFood
รายงานยอดขายสะสมประจำเดือน
วันที่รายงาน: 2026-07-01 ถึง 2026-07-31
ยอดรายการ 126,238.00
ค่าธรรมเนียม (GP) 27,731.22
ยอดภาษีมูลค่าเพิ่มค่าธรรมเนียม 1,941.19
ยอดรวมสุทธิประจำเดือน 96,330.59
`;
assert.equal(identifyIngestSource("", sfMail), "shopee-monthly-mail");
const sf = parseShopeeMonthlyMail(sfMail);
assert.equal(sf.monthKey, "2026-07");
assert.equal(sf.sales, 126238);
assert.equal(sf.gpOnly, 27731.22);
assert.equal(sf.gpVat, 1941.19);
assert.equal(sf.fee, 29672.41);
assert.equal(sf.transfer, 96330.59);

const sfPrev = previewIngestText(sfMail);
assert.equal(sfPrev.channel, "shopee");
assert.equal(sfPrev.ok, true);
assert.equal(sfPrev.amounts?.fee, 29672.41);

console.log("test-vat-ingest-preview: ok");
