# nPos — โอนเงินเข้าบัญชีร้าน (เทียบ Wongnai)

อัปเดต: **1.14.65** · `APP_BUILD` 323 · `POS_BUILD` 118 · vc **88**

## มติเทียบ Wongnai

| Wongnai | nPos |
|---------|------|
| ปุ่ม `โอนเงิน` / Bank Transfer (ไม่ใช่ PromptPay QR บนจอ) | ปุ่ม **โอนเงิน** · `paymentMethod=transfer` |
| พนักงานตรวจสลิป → ยืนยันปิดบิล | คอนเฟิร์มอย่างเดียว: **ตรวจสอบสลิปแล้ว OK** (ไม่กรอกเลขบัญชี/รหัส) |
| ลิ้นชักไม่เด้ง | `CashDrawerPolicy` เฉพาะ `cash` |
| ไม่นับในเงินสดลิ้นชักตอนปิดกะ | `expectedCash` = ทอนเริ่ม + ขายสด − ถอน |
| สรุปรอบแยกยอดโอน | X/Z · แผงรอบ · BO สรุปยอด |

PromptPay QR บนจอ POS ยังจอด (ซ่อน) — คนละเส้นทางกับโอนเข้าบัญชีร้าน

## ตรวจ

```bash
node scripts/test-npos-bank-transfer-pay.mjs
```
