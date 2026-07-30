# nPos — ใครเข้ากะ (เลือกชื่อเรียบง่าย)

อัปเดต: **แผน O1** · ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-bo-shift-readonly-checklist.md](./npos-bo-shift-readonly-checklist.md) S5 · [npos-bo-sales-retention-plan.md](./npos-bo-sales-retention-plan.md) P3

## เป้า
ตอนเปิดกะรู้ว่า **ใครเข้างาน** โดยไม่ทำระบบ PIN  
หลังร้าน `/pos-sales` เห็นชื่อผู้เปิดกะต่อรอบ

## นอกสcope รอบนี้
- [ ] PIN / login รายคน
- [ ] สิทธิ์แยกตามพนักงาน
- [ ] ผูกกะ OT อัตโนมัติเป็นผู้เปิดกะ

## สถานะปัจจุบัน
| ข้อ | มี? |
|-----|-----|
| เปิดกะ + เงินทอนเริ่ม | ใช่ — `OpenShiftFlow` |
| รายชื่อ `employees` ใน BO | ใช่ |
| ฟิลด์ผู้เปิดบน `posSessions` | ไม่ |
| Z «โดย» | ใช้ `receiptStaffName` ร้านเดียว |

## งาน

### O1.1 รายชื่อลงเครื่อง
- [ ] ดึงรายชื่อพนักงานที่ใช้งานจริง (เช่น `employees` active / ไม่ถูก archive)
- [ ] แคชในเครื่อง (อุ่นตอนเปิดแอปหรือก่อนเปิดกะ)
- [ ] ว่างรายชื่อ → ยังเปิดกะได้ด้วยพิมพ์ชื่อสั้น หรือ fallback `หน้าร้าน` (ตัดสินตอนลงมือ)

### O1.2 UI เปิดกะ
- [ ] หลังกรอก/ยืนยันเงินทอน → ขั้นเลือกชื่อ (ชิป/รายการแตะ)
- [ ] บังคับเลือก 1 คนก่อนเข้าขาย (หรือยืนยันชื่อที่พิมพ์)
- [ ] จำชื่อล่าสุดบนเครื่องเพื่อเลือกเร็วรอบถัดไป (ทางเลือก)

### O1.3 Sync
- [ ] `ShiftPrefs` เก็บ `openedByEmployeeId` + `openedByName`
- [ ] `nposSessionOpen` รับและเขียนลง `posSessions`
- [ ] ปิดกะไม่ลบฟิลด์ผู้เปิด · close อาจเพิ่ม `closedByName` ทีหลัง (ไม่บังคับ O1)

### O1.4 เอกสารกระดาษ
- [ ] Z/X แถว «โดย» = ผู้เปิดกะ · ไม่มีแล้วค่อย `receiptStaffName`

### O1.5 หลังร้าน
- [ ] `PosSession` type + `mapSession`
- [ ] ตาราง/การ์ดรอบโชว์ **ผู้เปิดกะ**
- [ ] กรองตามชื่อ (ทางเลือก)

### O1.6 ตรวจ
- [ ] Gate สคริปต์ (เมื่อมีโค้ด)
- [ ] คนเทส: เปิดกะเลือกชื่อ A → ขาย → ปิด → `/pos-sales` เห็น A
- [ ] คนเทส: สองรอบคนละชื่อ → ไม่สลับกัน

## ตรวจ
```bash
node scripts/test-npos-counter-ops-phases.mjs
# หลังลงมือ: node scripts/test-npos-shift-opener.mjs
```
