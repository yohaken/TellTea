# nPos — จอลูกค้า 4 โหมด (dual display)

อัปเดต: **1.14.0** · `APP_BUILD` 230

## โหมด
1. **สแตนด์บาย** — ชื่อร้าน · ยินดีต้อนรับ · หมุนเมนูแนะนำ (+รูป) · ข้อความท้ายใบเสร็จ
2. **เลือกรายการ** — ชื่อ × จำนวน · ราคาบรรทัด · ส่วนลด · ยอดรวม realtime
3. **ชำระเงิน** — ยอดสุทธิ · QR PromptPay หรือ รับ/ทอน เงินสด
4. **สำเร็จ** — ขอบคุณ / ยืนยัน · ค้าง ~3.5 วิ แล้วกลับสแตนด์บาย

## โค้ด
- `CustomerDisplayController` + `CustomerDisplayPresentation`
- `SellActivity` ผูก cart / cash keypad / PromptPay / commitSale
- Settings เทสยอดยังใช้ `CustomerAmountPresentation` (แผง payment)

## ตรวจ
```bash
node scripts/test-npos-customer-display.mjs
cd npos-telltea && ./gradlew assembleDebug
```

## มือ (เครื่อง 2 จอ)
| # | ผ่านเมื่อ |
|---|-----------|
| 1 | เปิดขาย → จอ 2 สแตนด์บาย (ชื่อร้าน/เมนูแนะนำ) |
| 2 | เพิ่มสินค้า → รายการ+ยอดบนจอ 2 ตาม realtime |
| 3 | เงินสด → เห็นรับ/ทอน · PromptPay → เห็น QR |
| 4 | ยืนยันขาย → ขอบคุณ แล้วกลับสแตนด์บาย |
