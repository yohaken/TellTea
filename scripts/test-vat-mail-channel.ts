import assert from "node:assert/strict";
import {
  isNoiseMail,
  isTaxInvoiceMail,
  matchMailChannel,
} from "../src/lib/vat-mail-channel";
import { DEFAULT_MAIL_RULES } from "../src/lib/vat-sales";

{
  const ch = matchMailChannel(
    "no-reply@grab.com",
    "สรุปยอดขายสำหรับคำสั่งซื้อ 30 กรกฎาคม 2026 ออนไลน์ประจำวันที่ GrabFood",
    DEFAULT_MAIL_RULES,
  );
  assert.equal(ch, "grab");
}

{
  const ch = matchMailChannel(
    "LINE MAN Wongnai <no-reply-merchant@lmwn.com>",
    "รายงานยอดขายรายวัน - LINE MAN Wongnai 31/07/69",
    DEFAULT_MAIL_RULES,
  );
  assert.equal(ch, "lineman");
}

{
  const ch = matchMailChannel(
    '"noreply.th" <noreply.th@shopeefood.com>',
    "Kongsi Tea Bar รายงานการโอนเงินสำหรับ ShopeeFood 2026-08-01",
    DEFAULT_MAIL_RULES,
  );
  assert.equal(ch, "shopee");
}

{
  const ch = matchMailChannel(
    "Shopee <no-reply@shopee.co.th>",
    "ใบแจ้งยอดค่าคอมมิชชั่น ShopeeFood ประจำเดือน",
    DEFAULT_MAIL_RULES,
  );
  assert.equal(ch, "shopee");
}

{
  // คำกว้างใน subject ต้องไม่ทำให้ Grab กลายเป็น shopee
  const ch = matchMailChannel(
    "no-reply@grab.com",
    "สรุปยอดขาย GrabFood",
    {
      shopee: {
        enabled: true,
        fromIncludes: ["shopee"],
        subjectIncludes: ["สรุปยอด", "ยอดขาย", "รายงานยอด"],
      },
      grab: DEFAULT_MAIL_RULES.grab,
      lineman: DEFAULT_MAIL_RULES.lineman,
    },
  );
  assert.equal(ch, "grab");
}

assert.equal(
  isTaxInvoiceMail("Grab: Receipt/Tax Invoice No. IM20260727011072"),
  true,
);
assert.equal(
  isNoiseMail(
    "LINE MAN Wongnai <no-reply-merchant@lmwn.com>",
    "รีเซ็ตรหัสผ่าน Wongnai Merchant App",
  ),
  true,
);
assert.equal(
  matchMailChannel(
    "LINE MAN Wongnai <no-reply-merchant@lmwn.com>",
    "รีเซ็ตรหัสผ่าน Wongnai Merchant App",
    DEFAULT_MAIL_RULES,
  ),
  "unknown",
);

console.log("ok vat-mail-channel");
