# nPos — เศษงานประสานเฟส (หลังแก้แคปจอ)

อัปเดต: **1.14.0** · จอลูกค้า 4 โหมด (สแตนด์บาย · เลือกรายการ · ชำระ · สำเร็จ)

## ทำแล้วรอบนี้
- [x] แก้ `reportNposScreenCapture` อัปโหลด bucket ที่มีจริง
- [x] deploy เขียน `TELLTEA_STORAGE_BUCKET` จาก ensure script (ไม่ hardcode ผิด)
- [x] ไม่ ack คำสั่งแคปก่อนอัปโหลดสำเร็จ (retry ได้)
- [x] PixelCopy ล้ม → วาด decor / ส่งภาพสถานะแทน
- [x] BO: แตะรูปแคป → `ImagePreviewModal` (ซูม/ปัดเหมือนบิล) ในแผงเครื่อง + ตรวจเครื่อง

## คิวถัดไป (ประสาน)

### A — แคป / หลังร้าน
- [x] อัปโหลด + lightbox มือถือ (1.12.2)
- [x] signed URL + diagnose `updatedAt` + device URL fallback + ไทม์ไลน์แคป (1.13.1)

### B — โคลนผังหน้าขายเว็บ + local-first
- [x] หมวดซ้าย · กริดรูป · ตะกร้า/ปุ่มส้ม (1.13.0)
- [x] แคชเมนู prefs + รูป disk · ซิงก์พื้นหลัง
- [ ] (polish) drag-reorder หมวดแบบเว็บ · RecyclerView ถ้าจอลื่น

### C — Local DB first (ต่อ)
- [ ] รวม outbox เป็นคิว DB ชัดขึ้น
- [ ] mutation นอกบิล (ของหมด) ทำ local ก่อนซิงก์

### D — จอลูกค้า
- [x] 4 โหมด Presentation (1.14.0) — ดู [npos-customer-display-checklist.md](./npos-customer-display-checklist.md)
- [x] D2 สถานะสั้นบนหน้าขาย + heartbeat `customerDisplay`
- [ ] D3 layout แยก portrait/landscape ละเอียด
- [ ] D4 คู่ขนาน POS เดิม (อย่าแย่งจอ 2)
- [ ] สื่อโปรโมชัน/วิดีโอจากหลังร้าน (ตอนนี้ใช้เมนูแนะนำ + ชื่อร้าน)

### E — นำร่อง
- [ ] P4 คนเทสเครื่องจริง
- [ ] P5 แก้จาก feedback
- [ ] P6 void เซิร์ฟเวอร์
- [ ] N7 ตัดเว็บขาย (หลัง P4–P5)

## ตรวจแคปรอบนี้
```bash
node scripts/test-npos-capture.mjs
```
