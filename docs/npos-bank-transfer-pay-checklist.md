# nPos — โอนเงินเข้าบัญชีร้าน (เทียบ Wongnai)

อัปเดต: **1.14.49** · `APP_BUILD` 307 · `POS_BUILD` 102 · vc **72**

## มติเทียบ Wongnai

| Wongnai | nPos |
|---------|------|
| ปุ่ม `โอนเงิน` / Bank Transfer (ไม่ใช่ PromptPay QR บนจอ) | ปุ่ม **โอนเงิน** · `paymentMethod=transfer` |
| พนักงานตรวจสลิป/แจ้งเตือน → ยืนยันปิดบิล | ไดอะล็อกยืนยัน + อ้างอิงสลิป (ถ้ามี) |
| ลิ้นชักไม่เด้ง | `CashDrawerPolicy` เฉพาะ `cash` |
| ไม่นับในเงินสดลิ้นชักตอนปิดกะ | `expectedCash` = ทอนเริ่ม + ขายสด − ถอน |
| สรุปรอบแยกยอดโอน | X/Z · แผงรอบ · BO สรุปยอด |

PromptPay QR บนจอ POS ยังจอด (ซ่อน) — คนละเส้นทางกับโอนเข้าบัญชีร้าน

## ตรวจ

```bash
node scripts/test-npos-bank-transfer-pay.mjs
```
