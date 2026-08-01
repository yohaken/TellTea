import assert from "node:assert/strict";
import {
  inferMailStudyHints,
  MAIL_STUDY_TAG_PRESETS,
} from "../src/lib/vat-mail-study";

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
assert.ok(MAIL_STUDY_TAG_PRESETS.includes("excel"));
console.log("ok vat-mail-study-hints");
