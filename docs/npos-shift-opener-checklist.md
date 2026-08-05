# nPos — ใครเข้ากะ (เลือกชื่อเรียบง่าย)

อัปเดต: **136** · vc **136** · `APP_BUILD` 718 · `POS_BUILD` 181  
ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-bo-shift-readonly-checklist.md](./npos-bo-shift-readonly-checklist.md) S5 · [npos-bo-sales-retention-plan.md](./npos-bo-sales-retention-plan.md) P3

## เป้า
ตอนเปิดรอบรู้ว่า **ใครเริ่มรอบนี้** โดยไม่ทำระบบ PIN และ**ไม่ผูกตารางกะ / OT**  
เลือกได้เฉพาะชื่อจากรายชื่อพนักงานในระบบ (roster) — **ห้ามพิมพ์ชื่อเอง**  
หลังปิดรอบต้องเลือกชื่อใหม่ทุกครั้ง (ไม่จำชื่ออัตโนมัติ)  
หลังร้าน `/pos-sales` เห็นชื่อผู้เปิดกะต่อรอบ

## นอกสcope รอบนี้
- [x] PIN / login รายคน — ไม่ทำ
- [x] สิทธิ์แยกตามพนักงาน — ไม่ทำ
- [x] ผูกกะ OT / ตารางกะอัตโนมัติเป็นผู้เปิดกะ — ไม่ทำ
- [x] รหัสปลดล็อกเครื่องแทนการเลือกชื่อ — ไม่ทำ

## สถานะ

| ข้อ | มี? |
|-----|-----|
| เปิดกะ + เงินทอนเริ่ม | ใช่ — `OpenShiftFlow` |
| รายชื่อ `employees` ใน BO → แคชเครื่อง | ใช่ — `nposShopSettings.employees` + `EmployeeRoster` |
| ฟิลด์ผู้เปิดบน `posSessions` | ใช่ — `openedByName` / `openedByEmployeeId` |
| Z «โดย» | ผู้เปิดกะ · fallback `receiptStaffName` |
| `/pos-sales` ป้ายผู้เปิด | ใช่ — แถวเครื่อง + รายละเอียดรอบ |

## งาน

### O1.1 รายชื่อลงเครื่อง
- [x] ดึง `employees` active (limit 80) ใน `nposShopSettings`
- [x] แคชใน `shopJson` / `EmployeeRoster`
- [x] ว่างรายชื่อ → บล็อกเปิดรอบ (ไม่ให้พิมพ์ชื่อเอง)

### O1.2 UI เปิดกะ
- [x] หลังกรอกเงินทอน → ขั้นเลือกชื่อ (ชิปจาก roster)
- [x] บังคับแตะ 1 ชื่อในระบบก่อนเข้าขาย — ไม่มีช่องพิมพ์
- [x] roster ว่าง → บล็อกเปิดรอบ + บอกให้เพิ่มพนักงานหลังบ้าน
- [x] หลังปิดรอบล้างชื่อ · เปิดรอบถัดไปเริ่มว่าง (ต้องแตะเอง)

### O1.3 Sync
- [x] `ShiftPrefs` เก็บ `openedByEmployeeId` + `openedByName`
- [x] `nposSessionOpen` รับและเขียนลง `posSessions` (resume คงชื่อเดิม)
- [x] ปิดกะไม่ลบฟิลด์ผู้เปิด

### O1.4 เอกสารกระดาษ
- [x] Z/X แถว «โดย» = ผู้เปิดกะ · ไม่มีแล้วค่อย `receiptStaffName`

### O1.5 หลังร้าน
- [x] `PosSession` type + `mapSession`
- [x] ตารางรอบโชว์ **ผู้เปิดกะ** (+ ค้นชื่อได้)

### O1.6 ตรวจ
- [x] Gate `scripts/test-npos-shift-opener.mjs`
- [ ] คนเทส: เปิดกะเลือกชื่อ A → ขาย → ปิด → `/pos-sales` เห็น A
- [ ] คนเทส: สองรอบคนละชื่อ → ไม่สลับกัน
- [ ] คนเทส: ไม่ผูกตารางกะ / OT

## ตรวจ
```bash
node scripts/test-npos-shift-opener.mjs
node scripts/test-npos-counter-ops-phases.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
