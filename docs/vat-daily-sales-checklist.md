# เช็คลิส: ยอดขายรายวัน · VAT · เมลแพลตฟอร์ม

> TellTea / P-Note · บัญชี VAT → กำไรกิจการ (บุคคลธรรมดา)  
> อัปเดต: 2026-07-28  
> แหล่งเดลิเวอรี่ = **API เมลเท่านั้น** · **ไม่ใช้ Excel** เป็นทางหลัก

---

## กฎเหล็ก — พนักงานหลังร้านไม่เห็น

ระบบนี้เป็น **เจ้าของเท่านั้น** (pattern เดียวกับ `/menu/` · `/pos-sales/`)  
**ห้าม** ทำเป็นสิทธิ์ที่มอบให้พนักงานได้ (ไม่ใช่แบบ `pnl` / `ownerBooks`)

| ชั้น | ข้อกำหนด |
|------|----------|
| **UI / เมนู** | การ์ดเข้าโมดูลโชว์เฉพาะ `staff.role === "owner"` ใน `/more/` |
| **Route gate** | หน้าทั้งหมด redirect พนักงานออก (เช่น → `/more/` หรือ `/ledger/`) แล้ว `return null` |
| **ไม่ใส่ `PERMISSION_KEYS`** | ไม่มีคีย์ grantable ในศูนย์พนักงาน — กันมอบสิทธิ์โดยพลาด |
| **Firestore** | `allow read, write: if isOwner()` (หรือ `isOwnerEmail()` ถ้ารองรับ) — พนักงานอ่านไม่ได้แม้รู้ path |
| **Cloud Functions** | ตรวจ owner ก่อนดึงเมล / parse / เขียนยอด |
| **Token เมล** | เก็บฝั่งเซิร์ฟเวอร์เท่านั้น · meta doc อ่านได้เฉพาะเจ้าของ |
| **แจ้งเตือน** | Push/alert เรื่องขาดเมล · VAT · ปิดเดือน → ส่งเฉพาะเจ้าของ |
| **ส่งออก** | ถ้ามีรายงาน VAT/ยอดช่องทางในอนาคต — ยังคง owner-only (ไม่ผูกกับ `exportData` ของพนักงาน) |

### เช็คความเป็นส่วนตัว (ทำซ้ำทุเฟสที่มี UI/ข้อมูล)

- [ ] พนักงานล็อกอินแล้ว **ไม่เห็น** การ์ดโมดูลใน อื่นๆ
- [ ] พนักงานเปิด URL ตรง ๆ แล้วถูกเด้งออก · ไม่เรนเดอร์ข้อมูล
- [ ] Firestore rules: staff `get`/`list` บน collection ใหม่ = deny
- [ ] ไม่โผล่ยอดเดลิเวอรี่/VAT ในบัญชีพนักงาน (`/ledger/`) หรือหน้าพนักงานอื่น
- [ ] ไม่สรุปยอดแพลตฟอร์มบนสลิป/Z หน้าร้านให้พนักงานเห็นเป็นรายงานบัญชี

---

## สถานะรวม

| เฟส | โฟกัส | สถานะ |
|-----|--------|--------|
| **P0** | แผน · เช็คลิส · ตกลงขอบเขต + owner-only | ✅ เอกสาร |
| **P1** | โครงข้อมูล + UI ตารางรายวัน (owner) + VAT สูตร | ⬜ |
| **P2** | เชื่อม API เมล (Gmail ก่อน) · กล่องรายงาน | ⬜ |
| **P3** | Parser ยอดรายวันต่อแพลตฟอร์ม · ยืนยันเข้าตาราง | ⬜ |
| **P4** | รวมยอดร้านรายวัน · สถานะวัน · แจ้งเตือนเจ้าของ | ⬜ |
| **P5** | ปิดเดือน → เสนอ `monthlyIncome` + รายงาน VAT เดือน | ⬜ |
| **P6** | Outlook/Hotmail · เมลรายสัปดาห์/เดือน (เทียบยอด) | ⬜ ทางเลือก |

**ตัดออกจากแผน**

- [x] นำเข้า / วาง Excel เป็นทางหลัก
- [x] ให้พนักงานมีสิทธิ์เปิดดูหรือกรอกยอดช่องทาง
- [x] POS เขียน `monthlyIncome` อัตโนมัติโดยไม่ผ่านชั้นยืนยันเจ้าของ
- [x] คิด VAT จากยอดโอนสุทธิแทนยอดที่ลูกค้าจ่าย

---

## P0 — ตกลงขอบเขต

- [x] เป้าหมาย: ยอดขายรายวันแยก **เดลิเวอรี่** (Shopee / Grab / LINE MAN) + **หน้าร้าน** → รวมยอดร้าน → VAT 7%
- [x] เดลิเวอรี่มาจาก **เมลผ่าน API** ไม่ใช้ Excel
- [x] หน้าร้าน suggest จาก `posSales` (owner อ่านได้อยู่แล้ว) — ไม่ปนเข้า ledger พนักงาน
- [x] รายจ่ายใช้ของเดิม (ledger / ownerBooks) · รายได้ปิดเดือนยืนยันมือครั้งเดียว
- [x] **Owner-only ทั้งก้อน** — พนักงานหลังร้านไม่เห็น
- [x] เอกสารเช็คลิสนี้

---

## P1 — โครงข้อมูล + UI ตารางรายวัน (ยังไม่ดึงเมล)

### ข้อมูล

- [ ] Collection `dailySales/{YYYY-MM-DD}` (หรือเทียบเท่า) ฟิลด์อย่างน้อย:
  - `storefrontGross` — หน้าร้าน รวม VAT
  - `delivery.shopee` / `grab` / `lineman` — ยอดลูกค้าจ่าย รวม VAT
  - optional: `fee` · `netTransfer` ต่อช่องทาง
  - `totalGross` · `vatBase` · `vatOutput`
  - `status`: `draft` | `confirmed`
  - `updatedAt` · `updatedBy`
- [ ] สูตร: `vatBase = totalGross / 1.07` · `vatOutput = totalGross - vatBase`
- [ ] โปรไฟล์ภาษี (เช่นใน `meta/businessProfile` หรือ doc แยก): `vatRegistered` · อีเมลรับรายงาน
- [ ] Firestore rules: **owner-only** read/write

### UI (owner-only)

- [ ] Route เช่น `/vat-sales/` หรือ `/daily-sales/` + gate `role === "owner"`
- [ ] การ์ดใน `/more/` เฉพาะ `isOwner` (ไม่ใช้ `can(staff, …)`)
- [ ] ตารางรายวัน: 3 ช่องเดลิเวอรี่ + หน้าร้าน + รวม + VAT
- [ ] สรุป 2 กลุ่ม: เดลิเวอรี่ | หน้าร้าน → ยอดขายร้านรายวัน
- [ ] กรอกมือได้ชั่วคราว (fallback ก่อนเมลเสร็จ)
- [ ] หน้าร้าน: ปุ่มดึงค่าแนะนำจากรายงาน POS วันนั้น (แก้ได้)
- [ ] เช็คความเป็นส่วนตัว (ดูบล็อกด้านบน)

### นอกสcope เฟสนี้

- [x] OAuth เมล
- [x] Excel import

---

## P2 — เชื่อม API เมล (Gmail ก่อน)

- [ ] OAuth Gmail ฝั่งเซิร์ฟเวอร์ (Cloud Functions) · scope อ่านอย่างเดียว
- [ ] เก็บ refresh token ใน meta ที่ **owner-only** (ห้าม staff อ่าน)
- [ ] UI เชื่อม/ตัดการเชื่อมเมล — เฉพาะเจ้าของ
- [ ] กฎค้นหาเมลต่อช่องทาง (from / subject / label) ตั้งค่าได้
- [ ] ดึงเมลรายงาน **รายวัน** เก็บ raw (`platformEmailReports/{id}` หรือเทียบเท่า) พร้อม `messageId` · `receivedAt` · `channel` · `rawText/html`
- [ ] หน้า “กล่องรายงานแพลตฟอร์ม”: รายการเมลที่จับได้ · สถานะยังไม่ parse — owner-only
- [ ] Job/callable sync ตรวจ caller = owner
- [ ] เช็คความเป็นส่วนตัว + token ไม่รั่วสู่ client staff

### นอกสcope เฟสนี้

- [x] Outlook/Hotmail (ไป P6)
- [x] Parse ตัวเลขเสร็จสมบูรณ์ (ไป P3)

---

## P3 — Parser ยอดขายรายวัน

ลำดับแนะนำ: แพลตฟอร์มที่เมลร้านเสถียรสุดก่อน แล้วค่อยตัวถัดไป → ShopeeFood

ต่อช่องทาง (Shopee / Grab / LINE MAN):

- [ ] Parser แยกโมดูล · เก็บ `parserVersion`
- [ ] ดึงอย่างน้อย: วันที่รายงาน · **ยอดลูกค้าจ่าย (รวม VAT)** · fee/GP ถ้ามี · ยอดโอนสุทธิถ้ามี
- [ ] แถวผลลัพธ์มี `emailId` · `parsedAt` · `confidence`
- [ ] UI คิว “รอตรวจ” — เจ้าของกดยืนยันก่อนเขียนเข้า `dailySales`
- [ ] ถ้า parse fail → ค้างในคิว + เก็บ raw ไม่ทิ้ง
- [ ] ไม่ overwrite วันที่ `confirmed` โดยอัตโนมัติโดยไม่ถาม
- [ ] เช็คความเป็นส่วนตัว

---

## P4 — รวมยอดร้านรายวัน · สถานะ · แจ้งเตือน

- [ ] รวมเดลิเวอรี่ 3 ช่อง + หน้าร้าน → `totalGross` / VAT
- [ ] สถานะวัน: รอเมล | รอตรวจ | ยืนยันแล้ว | ขาดช่องทาง
- [ ] Dashboard วันที่ขาดรายงาน (เฉพาะเจ้าของ)
- [ ] Push/แจ้งเตือนเจ้าของเมื่อเมลไม่มาหรือ parse ไม่ผ่าน
- [ ] แยกฟิลด์ชัด: ยอดขายลูกค้า (ฐาน VAT) ≠ ยอดโอนสุทธิ
- [ ] เช็คความเป็นส่วนตัว

---

## P5 — ปิดเดือน → P&L + VAT เดือน

- [ ] สรุปเดือนจากวันที่ `confirmed` เท่านั้น
- [ ] เสนอค่าเข้า `monthlyIncome` (แนะนำ P&L ใช้ **ยอดก่อน VAT**) — เจ้าของกดยืนยันครั้งเดียว
- [ ] ไม่ auto เขียน `monthlyIncome` จาก POS หรือจากเมลโดยตรง
- [ ] หน้ารายงาน VAT รายเดือน: ยอดขาย · ฐานภาษี · VAT 7% — owner-only
- [ ] คงรายจ่ายจาก ledger + ownerBooks ของเดิม
- [ ] เช็คความเป็นส่วนตัว

---

## P6 — ทางเลือก (หลังรายวันนิ่ง)

- [ ] Outlook / Hotmail (Microsoft Graph) OAuth
- [ ] เมลสรุปรายสัปดาห์ / รายเดือน — ใช้เทียบยอด ไม่แทนรายวัน
- [ ] Input VAT จากใบกำกับซื้อ (ถ้าจด VAT และต้องการ) — ยัง owner-only

---

## โมเดลข้อมูล (ร่าง)

```
dailySales/{YYYY-MM-DD}
  storefrontGross
  delivery: { shopee, grab, lineman }  // gross รวม VAT + fee/net แยกได้
  totalGross
  vatBase
  vatOutput
  status: draft | confirmed
  sources: { shopeeEmailId?, …, storefront: manual|pos_suggest }
  updatedAt, updatedBy

platformEmailReports/{id}
  channel: shopee | grab | lineman
  messageId, receivedAt, subject, from
  rawText / rawHtml
  parseStatus: pending | ok | fail | confirmed
  parsed?: { reportDate, grossInclusive, fee?, netTransfer?, confidence }
  parserVersion

meta/mailOAuth (หรือเทียบเท่า)     // owner-only
meta/vatSalesSettings              // owner-only · กฎค้นหาเมล · vatRegistered
```

Firestore rules (ทุก collection ด้านบน): **`isOwner()` เท่านั้น**

---

## ทดสอบสิทธิ์ (บังคับก่อนปิดแต่ละเฟสที่มี UI)

| เคส | คาดหวัง |
|-----|---------|
| ล็อกอินเจ้าของ | เห็นการ์ด · เปิดหน้าได้ · อ่าน/เขียนยอดได้ |
| ล็อกอินพนักงาน (สิทธิ์ครบรวม pnl/ownerBooks) | **ไม่เห็น** การ์ด · URL ตรง ๆ เด้งออก · Firestore deny |
| พนักงานรู้ `dailySales/2026-07-28` | `get`/`list` fail ตาม rules |
| เรียก callable sync เมลด้วย token พนักงาน | reject |

---

## อ้างอิงระบบเดิม

| ของเดิม | ใช้ยังไง |
|---------|----------|
| `/pnl/` + `monthlyIncome` | รับยอดปิดเดือนหลังยืนยัน (P5) |
| ledger / ownerBooks | รายจ่ายอย่างเดียว — ไม่โชว์ยอดเดลิเวอรี่ที่นี่ |
| `posSales` (owner read) | ค่าแนะนำหน้าร้านรายวัน |
| `/menu/` · `/pos-sales/` | แบบอย่าง owner gate + more card |
| `docs/pos-domain-policy.md` | ไม่ให้ POS เขียน monthlyIncome ตรง ๆ |

---

## คิวทำถัดไป

1. **P1** — โครง `dailySales` + หน้าตาราง owner-only + สูตร VAT  
2. **P2** — Gmail OAuth + กล่องเมลรายงาน  
3. **P3** — parse ทีละแพลตฟอร์ม  
4. **P4–P5** — สถานะวัน · ปิดเดือน · รายงาน VAT  
