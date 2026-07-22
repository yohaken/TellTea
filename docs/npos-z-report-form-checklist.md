# nPos — สลิปสรุปปิดกะ (Z) ให้ครบพิธีเคาน์เตอร์

อัปเดต: **1.14.14** (Z form) · ship **1.14.20** · `APP_BUILD` 252 · `POS_BUILD` 72 · `versionCode` 43  

เป้าหมาย: สลิป Z/X บน native พอใช้ปิดกะแบบ Wongnai **ที่ร้านเราใช้จริง**  
(หัวร้าน · พนักงานตั้งค่า · เปิด/ปิดเวลา · สด/PP · Over/Short · ช่องเซ็นมือ)  
**ไม่** ย้ายปิดกะไปเว็บ · **ไม่** ใส่ Delivery / ทานที่ร้าน

อ้างอิง flow: `BlindCloseFlow` (B1–B4 มีแล้ว)  
ฟอร์มใหม่: `ShiftReportFormBuilder` + `EscPos.documentReceipt`

---

## นโยบายที่ล็อก

| หัวข้อ | ตัดสิน |
|--------|--------|
| พิธีปิดกะประจำวัน | **Native เท่านั้น** (blind + ESC/POS) |
| เว็บ `/pos/shift` | ดูประวัติ / รายงานละเอียด — ไม่ใช่จุดปิดลิ้นชัก |
| Delivery / Lineman / Grab / ทานที่ร้าน | **ไม่ใส่** บนสลิปหรือใน flow |
| เซ็นชื่อ | บรรทัดว่างบนกระดาษ (เซ็นมือ) — ไม่ทำเซ็นดิจิทัลรอบนี้ |
| พนักงานรายคน (PIN/login) | นอกสcope — ใช้ `receiptStaffName` ไปก่อน |

---

## เฟสงาน

### Z1 ฟอร์มสลิป Z/X
- [x] `ShiftReportFormBuilder` — หัวร้าน (ชื่อ · ที่อยู่ · โทร)
- [x] ชื่อพนักงานจาก `receiptStaffName`
- [x] รอบ + session (ท้ายสั้น)
- [x] เวลาเปิดกะ · เวลาปิดกะ (Z) / พิมพ์เมื่อ (X)
- [x] สรุป: จำนวนบิล · ทำลายบิล · ส่วนลด · ยอดสุทธิ
- [x] ชำระ: เงินสด (บิล+บาท) · PromptPay (บิล+บาท)
- [x] Z ลิ้นชัก: เงินทอนเริ่ม + ขายสด = ควรมี · นับได้ · ส่วนต่าง · ทอนรอบถัดไป · เหตุผล
- [x] Z ช่องเซ็น: พนักงานส่งกะ · ผู้จัดการ/เจ้าของ
- [x] X ระบุ `*** ไม่ใช่การปิดรอบ ***` · ไม่มีเซ็น / ไม่มีนับเงิน
- [x] **ไม่มี** บล็อก Delivery / ช่องทางออเดอร์
- [x] พิมพ์ผ่าน `documentReceipt` (ไม่บังคับหัว TellTea ทับ)

### Z2 เชื่อม flow เดิม
- [x] `SaleSync.printShiftReport` ใช้ฟอร์มใหม่ทั้ง X และ Z
- [x] Blind close ยังส่ง `BlindCloseReport` ครบ (counted / expected / diff / leaveFloat / note)
- [x] ไม่เปลี่ยนลำดับ dialog Blind (นับก่อนโชว์ยอด)

### Z3 เอกสาร + เกต
- [x] เช็คลิสต์นี้
- [x] อัปเดต `npos-remaining-checklist.md`
- [x] `scripts/test-npos-z-report-form.mjs`
- [x] ใส่ใน `check-npos-shop.mjs`

### Z4 คนเทสเคาน์เตอร์ (ค้าง)
- [ ] ปิดกะจริง 1 รอบ · ตรวจสลิปมีหัวร้าน · เปิด/ปิด · Over/Short · ช่องเซ็น
- [ ] Snapshot กลางรอบ · ไม่มีเซ็น · มีข้อความไม่ใช่ปิดรอบ
- [ ] ไม่มีคำว่า Delivery / ทานที่ร้าน บนกระดาษ
- [ ] เซ็นมือบนสลิปแล้วเก็บได้

### Z5 (ทีหลัง — ไม่ในรอบนี้)
- [ ] พนักงานรายคนบนสลิป (หลังมี login/PIN กะ)
- [ ] หน้า BO การ์ดรายงานปิดกะจาก `posSessions`
- [ ] เว็บปิดกะให้ blind เท่า native (ถ้าจะให้คอมเป็นทางเลือก)

---

## ไฟล์หลัก

| ไฟล์ | บทบาท |
|------|--------|
| `.../printer/ShiftReportFormBuilder.java` | ข้อความ X/Z |
| `.../sell/SaleSync.java` | เรียกพิมพ์ |
| `.../shift/BlindCloseFlow.java` | โพรเซสนับเงิน (ไม่แตะลำดับ) |
| `docs/npos-z-report-form-checklist.md` | เช็คลิสต์นี้ |

---

## ตรวจ

```bash
node scripts/test-npos-z-report-form.mjs
node scripts/test-npos-blind-shift-close.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
