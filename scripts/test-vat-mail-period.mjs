/**
 * คัดแยกเดือนจากเนื้อเมล — รวมเคส Shopee สรุปเดือนที่หัวข้อเป็นวันส่ง
 * Run: node scripts/test-vat-mail-period.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  resolveReportPeriod,
  periodFieldsFromResolved,
} = require("../functions/vat-mail-period.js");
const { inferMailStudyTags } = require("../functions/vat-mail-study-tags.js");
const drive = require("../functions/vat-mail-drive.js");

{
  const body = `
รายงานยอดขายสะสมประจำเดือน
วันที่รายงาน: 2026-07-01 ถึง 2026-07-31
ร้าน: Kongsi Tea Bar
ยอดรวมสุทธิ: ฿96,330.59
จำนวนรายการสั่งซื้อทั้งหมด: 1572
`;
  const r = resolveReportPeriod({
    subject: "Kongsi Tea Bar รายงานการโอนเงินสำหรับ ShopeeFood 2026-08-01",
    snippet: "รายงานยอดขายสะสมประจำเดือน วันที่รายงาน: 2026-07-01 ถึง 2026-07-31",
    rawText: body,
    receivedAt: Date.parse("2026-08-01T08:00:00+07:00"),
  });
  assert.equal(r.reportKind, "monthly");
  assert.equal(r.monthKey, "2026-07");
  assert.equal(r.periodStart, "2026-07-01");
  assert.equal(r.periodEnd, "2026-07-31");
  assert.equal(r.reportDateGuess, "2026-07-31");
  assert.ok(r.confidence >= 0.9);
  assert.equal(r.source, "body-range");

  const fields = periodFieldsFromResolved(r);
  assert.equal(fields.periodMonthKey, "2026-07");

  const tags = inferMailStudyTags(
    {
      from: "noreply.th@shopeefood.com",
      subject: "Kongsi Tea Bar รายงานการโอนเงินสำหรับ ShopeeFood 2026-08-01",
      snippet: "รายงานยอดขายสะสมประจำเดือน",
      rawText: body,
      reportKind: r.reportKind,
      channel: "shopee",
      studyTags: ["sf-โอนรายวัน"],
    },
    null,
  );
  assert.ok(tags.includes("sf-สรุปเดือน"), String(tags));
  assert.ok(!tags.includes("sf-โอนรายวัน"), String(tags));
}

{
  const r = resolveReportPeriod({
    subject:
      "สรุปยอดขายสำหรับคำสั่งซื้อ 31 กรกฎาคม 2026 ออนไลน์ประจำวันที่ GrabFood",
    snippet: "",
    rawText: "",
    receivedAt: Date.parse("2026-08-01T03:00:00+07:00"),
  });
  assert.equal(r.reportKind, "daily");
  assert.equal(r.monthKey, "2026-07");
  assert.equal(r.reportDateGuess, "2026-07-31");
}

{
  assert.equal(
    drive.monthKeyFromReport({
      periodMonthKey: "2026-07",
      reportDateGuess: "2026-08-01",
    }),
    "2026-07",
  );
  assert.equal(
    drive.resolveDriveMonthKey(
      {
        periodMonthKey: "2026-07",
        periodEnd: "2026-07-31",
        reportDateGuess: "2026-07-31",
        receivedAt: Date.parse("2026-08-01T08:00:00+07:00"),
      },
      "2026-07",
    ),
    "2026-07",
  );
}

console.log("ok vat-mail-period");
