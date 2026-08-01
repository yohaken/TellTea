/**
 * Smoke: month-key helpers mirrored from vat-mail-monthly-pull.js logic
 */
import assert from "node:assert/strict";

const THAI_MONTHS = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
};

function monthKeyFromShopeeBody(text) {
  const m = String(text || "").match(
    /วันที่รายงาน\s*[:：]?\s*(\d{4}-\d{2}-\d{2})\s*ถึง\s*(\d{4}-\d{2}-\d{2})/,
  );
  return m?.[1] ? m[1].slice(0, 7) : "";
}

function monthKeyFromLinemanSubject(subject) {
  const m = String(subject || "").match(/ประจำเดือน\s*([ก-๙]+)\s+(\d{4})/);
  if (!m) return "";
  const month = THAI_MONTHS[m[1]];
  let year = Number(m[2]);
  if (!month || !year) return "";
  if (year > 2400) year -= 543;
  return `${year}-${String(month).padStart(2, "0")}`;
}

assert.equal(
  monthKeyFromShopeeBody("วันที่รายงาน: 2026-07-01 ถึง 2026-07-31"),
  "2026-07",
);
assert.equal(
  monthKeyFromLinemanSubject(
    "แจ้งค่าบริการระบบ LINE MAN GP ประจำเดือน กรกฎาคม 2569",
  ),
  "2026-07",
);
assert.equal(
  monthKeyFromLinemanSubject(
    "แจ้งค่าบริการระบบ LINE MAN GP ประจำเดือน พฤษภาคม 2569",
  ),
  "2026-05",
);

console.log("test-vat-mail-monthly-pull-helpers: ok");
