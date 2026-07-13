# POS Manual QA Checklist (เครื่องจริง)

ใช้หลัง deploy หรือก่อนเปิดร้าน — สิ่งที่ **Playwright / Emulator ทดแทนไม่ได้**

เครื่องเป้าหมาย: Android tablet Chrome · PWA `https://telltea-pos.web.app/pos/`

---

## ติดตั้งครั้งแรก

- [ ] เปิด Chrome → `/pos/` → auth ผ่าน (ไม่ขึ้น "เชื่อมต่อไม่สำเร็จ")
- [ ] กด **ติดตั้งแอป** หรือ Add to Home Screen → เปิดจากไอคอน
- [ ] แถบสถานะแสดง **เต็มจอ** / standalone
- [ ] Owner login ที่ back-office → Settings → ตั้งชื่อร้าน, PromptPay, **พิมพ์อัตโนมัติ**

## เข้างาน / ออกงาน

- [ ] กด **เข้างาน** → เข้าหน้าขายทันที (ไม่ค้าง)
- [ ] ใช้งาน 5–10 นาที → **ไม่ถูกดีด** กลับหน้าเข้างานเอง
- [ ] ปิดแท็บเปิดใหม่ → ยังอยู่หน้าขาย (ถ้ายังไม่ออกงาน)
- [ ] ออกงานที่ Shift → กลับหน้าเข้างาน

## ขายปกติ

- [ ] แตะเมนูไม่มีตัวเลือก → ตะกร้าเพิ่มทันที
- [ ] เมนูมีท็อปปิ้ง → popup → ราคารวมถูก
- [ ] เงินสด → ยืนยัน → flash "บันทึกแล้ว"
- [ ] ใบเสร็จ / Shift แสดงบิลใหม่

## เน็ตหลุด (ทดด้วยมือ)

- [ ] เปิดโหมดเครื่องบิน / ปิด WiFi ขณะขาย
- [ ] ขายเงินสดได้ → pill **เน็ตออฟ** / **รอส่ง**
- [ ] เปิดเน็ต → pill รอส่งหาย / บิลขึ้นเซิร์ฟเวอร์

## บิลค้าง

- [ ] กด pill **รอส่ง** → panel บิลรอส่ง
- [ ] **ส่งอีกครั้ง** / **ส่งทั้งหมด** ทำงาน

## เครื่องพิมพ์ (manual เท่านั้น)

- [ ] Settings → เพิ่มเครื่องพิมพ์ → **ทดสอบพิมพ์**
- [ ] ขาย 1 บิล → ใบเสร็จออก (browser print / ระบบ)
- [ ] ครั้งแรก Chrome อาจถามเลือก printer — บันทึกค่าเริ่มต้น

> หมายเหตุ: driver Bluetooth/USB/LAN ยังไม่มี — ทุก connection ใช้ browser print

## PromptPay

- [ ] QR ขึ้นหลังเลือก PromptPay
- [ ] (ไม่บังคับ) สแกนจ่ายจริง 1 บาท

---

## Automation ที่รันแทนได้

| สคริปต์ | ครอบคลุม |
|---------|----------|
| `npm run test:pos-session-chaos` | logic ไม่ดีดออกเมื่อ Firestore null |
| `npm run test:pos-session-reload-e2e` | reload offline ยังอยู่หน้าขาย |
| `npm run test:pos-offline-e2e` | ขาย offline → sync |
| `npm run test:pos-multi-tap-e2e` | แตะเมนูเร็ว qty ถูก |
| `npm run test:pos-stuck-bill-e2e` | panel บิลค้าง + ส่งอีกครั้ง |
| `npm run test:pos-e2e-all` | รวม phase 1 + 3 |
