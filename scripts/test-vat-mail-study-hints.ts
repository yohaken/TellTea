import assert from "node:assert/strict";
import {
  inferMailStudyHints,
  inferMailStudyTags,
  MAIL_STUDY_TAG_PRESETS,
} from "../src/lib/vat-mail-study";
import {
  buildMailStudyDump,
  defaultVatMailStudyNotesText,
} from "../src/lib/vat-mail-study-notes";
import type { PlatformEmailReport } from "../src/lib/vat-sales-mail";
import { DEFAULT_MAIL_RULES } from "../src/lib/vat-sales";

{
  const h = inferMailStudyHints({
    subject: "GrabFood Daily Sales Report",
    pdfFilenames: ["Transaction_Store_2026-07-01.csv"],
    reportKind: "daily",
  });
  assert.equal(h.grain, "daily");
  assert.ok(h.fileKinds.includes("csv"));
}

{
  const h = inferMailStudyHints({
    subject: "รายงานยอดขายประจำเดือน LINE MAN",
    pdfFilenames: ["monthly-report.pdf"],
    reportKind: "monthly",
  });
  assert.equal(h.grain, "monthly");
  assert.ok(h.fileKinds.includes("pdf"));
}

{
  const h = inferMailStudyHints({
    subject: "Shopee สรุปเดือน กรกฎาคม",
    snippet: "ไฟล์ excel แนบ",
    pdfFilenames: ["summary.xlsx"],
  });
  assert.equal(h.grain, "monthly");
  assert.ok(h.fileKinds.includes("excel"));
}

assert.ok(MAIL_STUDY_TAG_PRESETS.includes("grab-รายวัน"));
assert.ok(MAIL_STUDY_TAG_PRESETS.includes("lm-รายวัน-โอน"));
assert.ok(MAIL_STUDY_TAG_PRESETS.includes("excel"));

{
  const tags = inferMailStudyTags(
    {
      from: "no-reply@grab.com",
      subject: "สรุปยอดขายสำหรับคำสั่งซื้อ 30 กรกฎาคม 2026 GrabFood",
      pdfFilenames: ["day.pdf"],
    },
    DEFAULT_MAIL_RULES,
  );
  assert.ok(tags.includes("grab-รายวัน"));
  assert.ok(tags.includes("pdf"));
  assert.ok(!tags.includes("ข้าม"));
}

{
  const tags = inferMailStudyTags(
    {
      from: "LINE MAN Wongnai <no-reply-merchant@lmwn.com>",
      subject: "รายงานยอดโอนออก - LINE MAN Wongnai 01/08/69",
    },
    DEFAULT_MAIL_RULES,
  );
  assert.ok(tags.includes("lm-รายวัน-โอน"));
}

{
  const tags = inferMailStudyTags(
    {
      from: "Grab <no-reply@grab.com>",
      subject: "Grab: Receipt/Tax Invoice No. IM20260727011072",
    },
    DEFAULT_MAIL_RULES,
  );
  assert.ok(tags.includes("ข้าม"));
}

{
  const empty = buildMailStudyDump([]);
  assert.match(empty, /ยังไม่มีเมลซิงก์/);
  assert.match(defaultVatMailStudyNotesText(), /VAT MAIL STUDY NOTES/);
}

{
  const sample = {
    id: "r1",
    channel: "grab",
    subject: "GrabFood Daily Sales",
    from: "noreply@grab.com",
    receivedAt: Date.parse("2026-07-15T10:00:00Z"),
    pdfFilenames: ["day.csv"],
    studyTags: ["grab-รายวัน", "csv"],
    reportKind: "daily",
    snippet: "",
  } as PlatformEmailReport;
  const dump = buildMailStudyDump([sample]);
  assert.match(dump, /grab/);
  assert.match(dump, /daily/);
  assert.match(dump, /grab-รายวัน/);
  assert.match(dump, /#vat-mail-study-notes/);
}

console.log("ok vat-mail-study-hints");
