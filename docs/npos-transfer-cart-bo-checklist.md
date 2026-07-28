# nPos — cart draft code + transfer confirm + BO duration

อัปเดต: **1.14.64** · `APP_BUILD` 322 · `POS_BUILD` 117 · vc **87**

## มติ

| ข้อ | ทำ |
|-----|----|
| โอนเงิน | คอนเฟิร์มอย่างเดียว · `ตรวจสอบสลิปแล้ว OK` · ไม่มีช่องเลขอ้างอิง/เลขบัญชี |
| รหัสรายการ | หัวตะกร้า `ตะกร้า · #XXXXXX` เมื่อมีของ · รหัส draft ต่อตะกร้า |
| BO เวลารวม | คอลัมน์ **รวม** · เปิด = ถึงตอนนี้ · ปิด = closed−opened |
| BO active | รอบเปิดอยู่ขึ้นบน · ยอดจากบิล realtime แม้ยังไม่ปิด |

```bash
node scripts/test-npos-transfer-cart-bo.mjs
node scripts/test-npos-bank-transfer-pay.mjs
node scripts/test-npos-bo-sessions-super.mjs
```
