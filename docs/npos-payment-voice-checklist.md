# nPos — เสียงพูดรับเงิน / ทอน (Android TTS)

อัปเดต: **แผน O4** · ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-change-display-setting-checklist.md](./npos-change-display-setting-checklist.md) · แถบทอนที่มีแล้ว (1.14.85)

## เป้า
หลังขายสด พูดไทยสั้นชัด: **«รับมา X บาท ทอน Y บาท»**  
ใช้โมดูลฝังของระบบ (`TextToSpeech`) — ทันสมัยกว่าคลิปตัดต่อ · ไม่พึ่งเน็ตเป็นหลัก

## นอกสcope รอบนี้
- [ ] Cloud TTS (Google/Azure) เป็นค่าเริ่ม
- [ ] ฝังโมเดล neural ใหญ่ใน APK
- [ ] อ่านรายการเมนูทั้งบิล

## สถานะปัจจุบัน
| ข้อ | มี? |
|-----|-----|
| แถบทอน + ✕ + ทอนล่าสุด | ใช่ |
| บี๊บเว็บ POS | ใช่ (`pos-sound`) |
| TTS บน nPos | ไม่ |

## งาน

### O4.1 Helper
- [ ] คลาสเช่น `PaymentVoice` — init / speak / shutdown
- [ ] `Locale("th", "TH")` · `QUEUE_FLUSH`
- [ ] ไม่บล็อก UI thread ตอน init นาน

### O4.2 จุดเรียก
- [ ] ขายสด · มีเงินรับ/ทอน → พูดหลังบันทึก local สำเร็จ
- [ ] ทอน 0 → พูดสั้น «รับมา X บาท» หรือไม่พูด (ตัดสินตอนลงมือ · เขียนในเช็คลิสตอน ship)
- [ ] ไม่พูดซ้ำตอน sync สำเร็จรอบสอง

### O4.3 ตั้งค่า
- [ ] สวิตช์เปิด/ปิดในตั้งค่า (การชำระเงิน) และ/หรือเมนู ▦
- [ ] ค่าเริ่มต้น: **เปิด**
- [ ] เก็บเครื่องนี้เท่านั้น (เหมือนเวลาแสดงทอน)

### O4.4 Fallback
- [ ] ไม่มี engine / ไม่มีเสียงไทย → ไม่ครASH · เงียบหรือ `ToneGenerator` สั้น
- [ ] Log ops สั้นเมื่อพูดไม่ได้ (ไม่สแปม)

### O4.5 ตรวจ
- [ ] Gate: wiring + สตริงประโยค + prefs
- [ ] คนเทส SUNMI: รับ 100 ทอน 20 → ได้ยินตัวเลขถูก
- [ ] คนเทส: ปิดสวิตช์ → เงียบ · แถบทอนยังทำงาน

## ประโยคเป้าหมาย
```
รับมา {received} บาท ทอน {change} บาท
```

## ตรวจ
```bash
node scripts/test-npos-counter-ops-phases.mjs
# หลังลงมือ: node scripts/test-npos-payment-voice.mjs
```
