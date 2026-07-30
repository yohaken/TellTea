# nPos / หลังร้าน — เฟสงานเคาน์เตอร์ถัดไป (รอบกะ · เมนู · เสียง)

อัปเดต: **O3+O4 ship 1.14.89** · อ้างอิง `/pos-sales` + nPos 1.14.89  
หลัก: **ทำทีละเฟสให้จบและเทสได้** · ไม่ขยาย PIN / delta เมนู / cloud TTS ในรอบแรก

ดูเช็คลิสย่อย:
[npos-shift-opener-checklist.md](./npos-shift-opener-checklist.md) ·
[npos-session-cash-detail-checklist.md](./npos-session-cash-detail-checklist.md) ·
[npos-menu-version-sync-checklist.md](./npos-menu-version-sync-checklist.md) ·
[npos-payment-voice-checklist.md](./npos-payment-voice-checklist.md)

---

## นอกเฟส (ไม่ทำตอนนี้)

| ข้อ | เหตุ |
|-----|------|
| PIN / login พนักงานเต็มระบบ | หนัก · เฟสหลังเมื่อต้องการล็อกสิทธิ์ |
| ซิงก์เมนูทีละรายการ (delta) | โหลดทั้งชุดพอเมื่อมี `menuVersion` |
| Cloud TTS / โมเดลเสียงฝังใหญ่ | พึ่งเน็ต / APK โต · ใช้ Android TTS ก่อน |
| นับเงินแยกธนบัตร · ช่องทางเดลิเวอรี่ | ยังไม่มี use-case บังคับ |
| ปิดกะจากเว็บ | นอกสcope · Z บน native |

---

## สถานะที่มีแล้ว (อย่าทำซ้ำ)

| ข้อ | ที่ |
|-----|-----|
| เปิดกะ + เงินทอนเริ่ม · Blind ปิด · Over/Short | `OpenShiftFlow` / `BlindCloseFlow` |
| การ์ดรอบหลังร้าน: เปิด/นับ/คาดหวัง/ส่วนต่าง/ทอนค้าง/เบิกรวม | `/pos-sales` expand |
| แถบทอน 10 วิ · ✕ · ทอนล่าสุด · ตั้งเวลาจาก ▦ | 1.14.85 |
| เบิกเงินสด + เหตุผลบนเครื่อง | `ShiftPrefs` + UI · ยังไม่ครบฝั่งเซิร์ฟเวอร์ |

---

## ลำดับเฟส

```
O0 คนเทสฐาน → O1 ใครเข้ากะ → O2 รายละเอียดเงินรอบ
         → O3 เมนูซิงก์ค้าง → O4 เสียงรับ/ทอน
```

---

## O0 — คนเทสฐาน (ไม่เขียนโค้ด)

ยืนยันของที่มีก่อนเริ่มเฟสใหม่

- [ ] O0.1 เปิดกะกรอกทอน → ขายสดทอน → แถบเขียว + ทอนล่าสุด
- [ ] O0.2 เบิกเงินสดใส่เหตุผล → ปิด Z → หลังร้านเห็น `cashOutTotal`
- [ ] O0.3 แก้เมนูหลังร้านตอน nPos เปิดค้าง → กริดยังไม่เปลี่ยน (ยืนยันช่องว่าง O3)
- [ ] O0.4 `/pos-sales` เปิดแถวรอบ → เห็น opening / counted / diff

**จบเมื่อ:** มีบันทึกหน้างาน ผ่าน/ไม่ผ่าน

---

## O1 — ใครเข้ากะ (เรียบง่าย) · **ship 1.14.86**

**ปัญหา:** หลังร้านเห็นเครื่อง/รอบ แต่ไม่รู้คน  
**เป้า:** ตอนเปิดกะเลือกชื่อจากรายชื่อพนักงาน → บันทึกบน `posSessions` → โชว์ที่ `/pos-sales`  
**ไม่ทำ:** PIN · สิทธิ์แยกรายคน · ผูก OT / ตารางกะ

เช็คลิส: [npos-shift-opener-checklist.md](./npos-shift-opener-checklist.md)

### งานย่อ
- [x] O1.1 ดึงรายชื่อ `employees` ลงเครื่องตอนอุ่นข้อมูล (`nposShopSettings`)
- [x] O1.2 `OpenShiftFlow`: หลังกรอกทอน → เลือกชื่อ (บังคับ 1 คน / พิมพ์ได้)
- [x] O1.3 `nposSessionOpen` + `ShiftPrefs` เก็บ `openedByEmployeeId` / `openedByName`
- [x] O1.4 Z «โดย» ใช้ชื่อผู้เปิดกะ (fallback `receiptStaffName`)
- [x] O1.5 `/pos-sales` ป้าย **ผู้เปิดกะ**
- [x] O1.6 Gate (`test-npos-shift-opener.mjs`) · คนเทสค้างหน้างาน

**จบเมื่อ:** เปิดกะเลือกชื่อ → หลังร้านเห็นชื่อคนนั้นบนรอบนั้น

---

## O2 — รายละเอียดเงินรอบ (เบิก + สรุปการ์ด) · **ship 1.14.87**

**ปัญหา:** รู้ยอดเบิกรวม แต่ไม่รู้ทีละครั้ง · การ์ดรอบยังขาดบางตัวเลขที่มีอยู่แล้ว  
**เป้า:** เก็บ/โชว์รายการเบิก + สรุปปิดรอบให้ครบโดยไม่ต้องเปิดบิลทีละใบ

เช็คลิส: [npos-session-cash-detail-checklist.md](./npos-session-cash-detail-checklist.md)

### งานย่อ
- [x] O2.1 CF `nposSessionClose` persist `cashDropNotes[]`
- [x] O2.2 `PosSession` + `mapSession` อ่าน notes / discrepancyLabel / discount / voided / tender bill counts / remit
- [x] O2.3 UI expand รอบ: รายการเบิก · ป้ายตรง/เกิน/ขาด · ยอดนำส่ง
- [x] O2.4 UI รับเงินเข้ากลางรอบ — **เลื่อน** (มี `cashInTotal` พอสำหรับรอบนี้)
- [x] O2.5 Gate · คนเทสค้างหน้างาน

**จบเมื่อ:** เบิก 2 ครั้งคนละเหตุผล → หลังร้านเห็นทั้ง 2 บรรทัดหลังปิดกะ

---

## O3 — เมนูซิงก์ตอนแอปค้าง · **ship 1.14.89**

**ปัญหา:** แก้เมนูหลังร้านแล้วหน้าขายที่เปิดอยู่ไม่เปลี่ยน  
**เป้า:** bump `menuVersion` → heartbeat/shop บอกเครื่อง → โหลดเมนูทั้งชุดเงียบๆ  
**ไม่ทำ:** ดึงเต็มทุก 5 วิ · delta รายการ

เช็คลิส: [npos-menu-version-sync-checklist.md](./npos-menu-version-sync-checklist.md)

### งานย่อ
- [x] O3.1 แหล่งความจริง `menuVersion` (bump ทุกครั้งที่บันทึกเมนู BO)
- [x] O3.2 ส่ง version ใน heartbeat + `nposShopSettings` / เมนู snapshot
- [x] O3.3 Native เทียบ local → `reloadMenu(true)` เมื่อเปลี่ยน
- [x] O3.4 Throttle ไม่รัว (30 วิ ต่อครั้ง)
- [x] O3.5 ปุ่มรีเฟรชมือใน ▦ เป็นสำรอง + toast
- [x] O3.6 Gate · คนเทสค้างหน้างาน

**จบเมื่อ:** แก้ราคาหลังร้าน → ภายใน ~1–2 นาที (หรือหลัง heartbeat) กริดขายขึ้นราคาใหม่โดยไม่รีสตาร์ทแอป

---

## O4 — เสียงพูดรับเงิน / ทอน · **ship 1.14.89** (ฝังคลิป)

**ปัญหา:** มองแถบทอนอย่างเดียว · มือยุ่งอาจพลาดตัวเลข · เครื่องไม่มี TTS ไทย  
**เป้า:** พูดไทยสั้น «รับมา X บาท ทอน Y บาท» หลังขายสด  
**วิธี:** คลิป `res/raw/voice_*.mp3` ประกอบคำ · สวิตช์เปิด/ปิดในตั้งค่า · **ไม่พึ่ง OEM TTS**

เช็คลิส: [npos-payment-voice-checklist.md](./npos-payment-voice-checklist.md)

### งานย่อ
- [x] O4.1 คลิปฝัง + `ThaiCashWords` + `PaymentVoice` queue
- [x] O4.2 เรียกตอน `onLocalSaved` ขายสด (รับ + ทอน)
- [x] O4.3 ตั้งค่าเปิด/ปิด + ค่าเริ่มต้นเปิด
- [x] O4.4 ออฟไลน์ได้ทุกเครื่องที่ติดตั้ง APK
- [x] O4.5 Gate · คนเทสค้างหน้างาน

**จบเมื่อ:** ขายสดทอน แล้วได้ยินประโยคถูกต้อง · ปิดสวิตช์แล้วเงียบ

---

## ลำดับ ship ที่แนะนำ

| รอบ | เฟส | เหตุผล |
|-----|------|--------|
| 1 | O1 | เห็นคนบนรอบทันที · สcope เล็ก |
| 2 | O2 | เงินรอบครบ · ROI สูงจากของที่มีแล้ว |
| 3 | O3 | แก้ pain เมนูค้าง |
| 4 | O4 | polish เคาน์เตอร์ |

O1 กับ O4 ทำคู่ขนานได้ถ้าคนพอ (คนละพื้นผิว: session vs TTS)

---

## ตรวจแผน (docs gate)

```bash
node scripts/test-npos-counter-ops-phases.mjs
```
