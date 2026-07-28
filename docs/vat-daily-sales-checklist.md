# เช็คลิส: ยอดขายรายวัน · VAT · เมลแพลตฟอร์ม (ฉบับยาว)

> TellTea / P-Note · บัญชี VAT → กำไรกิจการ (บุคคลธรรมดา)  
> อัปเดต: 2026-07-28  
> แหล่งเดลิเวอรี่ = **API เมลเท่านั้น** · **ไม่ใช้ Excel** เป็นทางหลัก  
> Route เป้าหมาย (ร่าง): `/vat-sales/` · ชื่อการ์ด: **ยอดขาย / VAT**

---

## 0) กฎเหล็ก — พนักงานหลังร้านไม่เห็น

ระบบนี้เป็น **เจ้าของเท่านั้น** (pattern เดียวกับ `/menu/` · `/pos-sales/`)  
**ห้าม** ทำเป็นสิทธิ์ที่มอบให้พนักงานได้ (ไม่ใช่แบบ `pnl` / `ownerBooks`)

| ชั้น | ข้อกำหนด | เช็ค |
|------|----------|------|
| UI / เมนู | การ์ดโชว์เฉพาะ `staff.role === "owner"` ใน `/more/` | ☐ |
| Route gate | redirect พนักงาน → `/more/` แล้ว `return null` ไม่เรนเดอร์ข้อมูล | ☐ |
| ไม่ใส่ `PERMISSION_KEYS` | ไม่มีคีย์ในศูนย์พนักงาน · กันมอบสิทธิ์โดยพลาด | ☐ |
| Firestore | `allow read, write: if isOwner()` — พนักงานอ่านไม่ได้แม้รู้ path | ☐ |
| Cloud Functions | ตรวจ owner ก่อนดึงเมล / parse / เขียนยอด | ☐ |
| Token เมล | เก็บฝั่งเซิร์ฟเวอร์ · meta อ่านได้เฉพาะเจ้าของ (แบบ `foodstoryAuth`) | ☐ |
| แจ้งเตือน | Push เรื่องขาดเมล · VAT · ปิดเดือน → **เฉพาะเจ้าของ** | ☐ |
| ส่งออก | รายงาน VAT/ช่องทางในอนาคตยัง owner-only · ไม่ผูก `exportData` พนักงาน | ☐ |
| nPos / สลิป / Z | ไม่โชว์สรุปบัญชีแพลตฟอร์ม+VAT เป็นรายงานบัญชีให้พนักงานเคาน์เตอร์ | ☐ |
| `/ledger/` · `/pnl/` หน้าพนักงาน | ไม่ฝังตารางเดลิเวอรี่/VAT ลงหน้าพนักงาน | ☐ |

### 0.1 ทำซ้ำทุเฟสที่มี UI หรือข้อมูลใหม่

- [ ] พนักงานล็อกอิน (แม้เปิด `pnl` + `ownerBooks` + `exportData` ครบ) **ไม่เห็น** การ์ดโมดูล
- [ ] พนักงานเปิด `/vat-sales/` ตรง ๆ → เด้งออก · network ไม่โหลดยอดขายช่องทาง
- [ ] Firestore: staff `get` / `list` บน collection ใหม่ = **deny**
- [ ] Callable/HTTP ที่เกี่ยวกับเมล: token พนักงาน = **reject**
- [ ] ไม่มีข้อความยอด Shopee/Grab/LINE MAN ใน UI ที่พนักงานใช้ประจำ
- [ ] DevTools: response ของหน้าพนักงานไม่มีฟิลด์ `dailySales` / `platformEmailReports`

### 0.2 เคสทดสอบสิทธิ์ (บังคับก่อนปิดเฟส)

| # | เคส | คาดหวัง | P1 | P2 | P3 | P4 | P5 |
|---|------|---------|----|----|----|----|-----|
| A | เจ้าของเห็นการ์ด + เปิดหน้าได้ | ผ่าน | ☐ | ☐ | ☐ | ☐ | ☐ |
| B | พนักงานสิทธิ์ครบ ไม่เห็นการ์ด | ผ่าน | ☐ | ☐ | ☐ | ☐ | ☐ |
| C | พนักงานเปิด URL ตรง | redirect + ไม่เรนเดอร์ | ☐ | ☐ | ☐ | ☐ | ☐ |
| D | พนักงาน `get dailySales/{date}` | permission-denied | ☐ | ☐ | ☐ | ☐ | ☐ |
| E | พนักงาน `list platformEmailReports` | permission-denied | — | ☐ | ☐ | ☐ | ☐ |
| F | พนักงานเรียก sync เมล | reject | — | ☐ | ☐ | ☐ | ☐ |
| G | พนักงานอ่าน `meta/mailOAuth` / token | deny หรือไม่มีบน client | — | ☐ | ☐ | ☐ | ☐ |
| H | พนักงานไม่ได้รับ push VAT/ขาดเมล | ไม่ได้รับ | — | — | — | ☐ | ☐ |

---

## สถานะรวม

| เฟส | โฟกัส | สถานะ |
|-----|--------|--------|
| **P0** | แผน · เช็คลิส · ขอบเขต + owner-only | ✅ เอกสาร |
| **P1** | Types · rules · lib · UI ตารางรายวัน + VAT สูตร | ✅ |
| **P2** | Gmail OAuth · กล่องรายงานเมล · sync | ✅ |
| **P3** | Parser รายวันต่อแพลตฟอร์ม · คิวยืนยัน | ⬜ |
| **P4** | สถานะวัน · dashboard ขาดรายงาน · แจ้งเตือนเจ้าของ | ⬜ |
| **P5** | ปิดเดือน → `monthlyIncome` + รายงาน VAT เดือน | ⬜ |
| **P6** | Outlook/Hotmail · เมลสัปดาห์/เดือน · Input VAT | ⬜ ทางเลือก |
| **P7** | ขัดเกลา UX · audit log · สำรอง raw · เอกสารผู้ใช้ | ⬜ หลังนิ่ง |

### ตัดออกจากแผน (ยืนยันแล้ว)

- [x] นำเข้า / วาง / ดาวน์โหลด Excel เป็นทางหลักของเดลิเวอรี่
- [x] ให้พนักงานมีสิทธิ์เปิดดูหรือกรอกยอดช่องทาง
- [x] POS เขียน `monthlyIncome` อัตโนมัติโดยไม่ผ่านชั้นยืนยันเจ้าของ
- [x] คิด VAT จากยอดโอนสุทธิแทนยอดที่ลูกค้าจ่าย
- [x] รวมยอดเดลิเวอรี่เข้า `/ledger/` ของพนักงาน
- [x] สิทธิ์ grantable ใหม่ใน `PERMISSION_KEYS` สำหรับโมดูลนี้

---

## P0 — ตกลงขอบเขต

- [x] เป้าหมาย: ยอดขายรายวันแยก **เดลิเวอรี่** (ShopeeFood / Grab / LINE MAN) + **หน้าร้าน** → รวมยอดร้าน → VAT 7%
- [x] เดลิเวอรี่มาจาก **เมลผ่าน API** ไม่ใช้ Excel
- [x] หน้าร้าน suggest จาก `posSales` (owner อ่านได้อยู่แล้ว) — ไม่ปน ledger พนักงาน
- [x] รายจ่ายใช้ของเดิม (ledger / ownerBooks) · รายได้ปิดเดือนยืนยันมือครั้งเดียว
- [x] **Owner-only ทั้งก้อน** — พนักงานหลังร้านไม่เห็น
- [x] บุคคลธรรมดา · VAT 7% จากยอดรวมลูกค้า (inclusive)
- [x] แยกฟิลด์: ยอดลูกค้า (ฐาน VAT) ≠ ค่าธรรมเนียม ≠ ยอดโอนสุทธิ
- [x] เอกสารเช็คลิสฉบับยาวนี้

### P0.1 คำศัพท์ในระบบ (ใช้ให้สม่ำเสมอ)

| คำใน UI | ความหมาย | ใช้คิด VAT? |
|---------|----------|-------------|
| ยอดลูกค้า / รวม VAT | ยอดที่ลูกค้าจ่ายบนแอป | ✅ ฐานหลัก |
| ฐานภาษี | ยอดลูกค้า ÷ 1.07 | ผลลัพธ์ |
| VAT 7% | ยอดลูกค้า − ฐานภาษี | ผลลัพธ์ |
| ค่า GP / ค่าธรรมเนียม | แพลตฟอร์มหัก | ❌ ไม่ใช่ฐาน VAT |
| ยอดโอนสุทธิ | เงินเข้าบัญชีจริง | ❌ ใช้เทียบเงินสด |
| ยอดหน้าร้าน | รวมจาก POS / กรอกมือ (รวม VAT ถ้าร้านคิดรวม) | ✅ รวมในยอดร้าน |
| ยอดขายร้านรายวัน | เดลิเวอรี่ + หน้าร้าน | ✅ |

- [ ] ติดป้ายคำศัพท์สั้น ๆ ในหน้า UI (tooltip หรือข้อความใต้หัวตาราง)

---

## P1 — โครงข้อมูล + UI ตารางรายวัน (ยังไม่ดึงเมล)

### P1.1 Types / ค่าคงที่

- [x] ไฟล์เช่น `src/lib/vat-sales.ts` (หรือแยก `vat-sales-types.ts`)
- [x] `DeliveryChannel = "shopee" | "grab" | "lineman"`
- [x] ป้ายไทย: ShopeeFood · Grab · LINE MAN
- [x] `DailySalesStatus = "draft" | "confirmed"`
- [x] `ChannelAmount`: `{ grossInclusive: number; fee?: number; netTransfer?: number }`
- [x] `DailySalesDoc` ครบฟิลด์ตามโมเดลด้านล่าง
- [x] helper วันที่ Bangkok: `dateKeyFromMs` / `todayBangkokDateKey` (reuse `bangkok-day` ถ้ารมี)
- [x] เงิน: ปัดทศนิยม 2 ตำแหน่งแบบร้านใช้ร่วมกัน (กำหนดฟังก์ชันเดียว ห้ามปัดคนละแบบ)
- [x] สูตรรวมศูนย์: `computeVatFromGross(gross)` → `{ vatBase, vatOutput }`
- [x] สูตรรวมวัน: `sumDailySales(doc)` → totalGross / deliveryTotal / storefront / VAT
- [x] validate: ยอดไม่ติดลบ · NaN ห้ามบันทึก · วันที่รูปแบบ `YYYY-MM-DD` เท่านั้น

### P1.2 Firestore model

```
dailySales/{YYYY-MM-DD}
  dateKey: string
  storefront: ChannelAmount          // หรือ storefrontGross number + fee/net optional
  delivery: {
    shopee: ChannelAmount
    grab: ChannelAmount
    lineman: ChannelAmount
  }
  totalGross: number
  deliveryGross: number
  storefrontGross: number
  vatBase: number
  vatOutput: number
  status: draft | confirmed
  sources: {
    storefront: "manual" | "pos_suggest"
    shopee?: "manual" | "email"
    grab?: "manual" | "email"
    lineman?: "manual" | "email"
  }
  note?: string
  confirmedAt?: number
  confirmedBy?: string
  updatedAt: number
  updatedBy: string

meta/vatSalesSettings                // owner-only ใน rules
  vatRegistered: boolean
  vatRate: 0.07                      // คงที่ตอนนี้ แต่เก็บไว้
  pnlIncomeMode: "exVat" | "incVat"  // ค่าเริ่มต้นแนะนำ exVat
  reportEmails: string[]             // อีเมลที่คาดว่าจะรับรายงาน
  channelsEnabled: { shopee, grab, lineman, storefront }
  updatedAt, updatedBy
```

- [x] สร้าง/อ่าน/เขียน `dailySales` ผ่าน lib เท่านั้น (หน้า UI ไม่แตะ Firestore ตรง ๆ ถ้าทีมใช้แบบเดิมก็ตาม pattern ใกล้เคียง)
- [x] `listDailySalesInMonth(YYYY-MM)`
- [x] `getDailySales(dateKey)` / `upsertDailySales(...)`
- [x] `confirmDailySales(dateKey)` / `unconfirmDailySales(dateKey)` (unconfirm = owner เท่านั้น)
- [x] เมื่อแก้ตัวเลขวัน `confirmed` → บังคับถาม หรือเด้งกลับ `draft` ตามที่ตกลงใน UI
- [x] อ่าน/เขียน `meta/vatSalesSettings` owner-only
- [x] **ไม่** เก็บ secret ใน `businessProfile` (โปรไฟล์นั้น staff อ่านได้)

### P1.3 Firestore rules

- [x] `match /dailySales/{dateId}` → read/write `isOwner()` เท่านั้น
- [ ] validate เบา ๆ ตอน create/update: มี `dateKey` · ตัวเลขเป็น number · ไม่ติดลบ (ถ้ารules รองรับ)
- [x] `meta/vatSalesSettings` → อ่าน/เขียนเฉพาะ `isOwner()` (อย่าให้ตกกฎ `isStaff()` กว้างของ `meta/{docId}`)
- [ ] ทดสอบ rules ด้วยบัญชี staff จริงหรือ emulator
- [ ] deploy rules พร้อมฟีเจอร์ (หรือก่อนเปิด UI production)

### P1.4 Route + นำทาง (owner-only)

- [x] หน้า `src/app/vat-sales/page.tsx` (หรือชื่อที่ตกลง)
- [x] `AuthGate` + gate `staff.role === "owner"` → ไม่ใช่ `can(staff, …)`
- [x] พนักงาน → `router.replace("/more/")` + `return null`
- [x] การ์ดใน `/more/` อยู่บล็อก `isOwner` เดียวกับเมนู / รายงาน POS
- [x] ชื่อการ์ดชัด: **ยอดขาย / VAT** · คำอธิบายสั้น: เดลิเวอรี่ + หน้าร้าน · รายวัน
- [x] `AppShell` / prefix นำทางรองรับ path ใหม่ถ้าจำเป็น
- [x] **ไม่** เพิ่มแท็บ dock พนักงาน
- [x] **ไม่** เพิ่มใน `PERMISSION_GROUPS` / ศูนย์พนักงาน

### P1.5 UI ตารางรายวัน

- [x] เลือกเดือน (ค่าเริ่มต้นเดือนปัจจุบัน Bangkok)
- [x] ตารางแถว = วันที่ในเดือน
- [x] คอลัมน์: วันที่ | Shopee | Grab | LINE MAN | รวมเดลิเวอรี่ | หน้าร้าน | **ยอดขายร้าน** | ฐานภาษี | VAT 7% | สถานะ
- [x] สรุปหัวหรือท้าย: กลุ่มเดลิเวอรี่ | กลุ่มหน้าร้าน | รวมเดือน (เฉพาะวันที่มียอด / ทั้งเดือน — ระบุให้ชัดใน UI)
- [x] แก้ไขเซลล์ได้เมื่อ `draft` (กรอกมือ = fallback ก่อนเมลเสร็จ)
- [x] วัน `confirmed` ล็อกแก้ หรือแก้แล้วต้อง unlock
- [x] ปุ่มยืนยันรายวัน (ยืนยันหลายวันพร้อมกัน — ยังไม่ทำ)
- [x] แสดงแหล่งที่มาเล็ก ๆ (`มือ` / `POS` / ภายหลัง `เมล`)
- [x] empty state: ยังไม่มีข้อมูลในเดือน
- [x] loading / error state
- [x] mobile: เลื่อนแนวนอนได้หรือสลับการ์ดรายวัน อ่านรู้เรื่อง
- [x] ไม่ใช้การ์ดเยอะเกินจำเป็น — โฟกัสตาราง/รายวัน

### P1.6 หน้าร้านจาก POS (suggest)

- [x] ปุ่ม “ดึงยอดหน้าร้านจาก POS” ต่อวันหรือทั้งเดือน
- [x] อ่าน `posSales` เฉพาะ owner (rules มีอยู่แล้ว)
- [x] รวมยอดวัน Bangkok ให้ตรงกับรายงาน `/pos-sales/`
- [x] ไม่นับบิล void
- [x] ใส่ `sources.storefront = "pos_suggest"`
- [x] ไม่ overwrite ค่าที่เจ้าของพิมพ์มือแล้วโดยไม่ถาม (confirm dialog)
- [x] **ไม่** เขียนกลับไปที่ POS / ledger

### P1.7 ตั้งค่าภาษีสั้น ๆ (ในหน้าเดียวกันหรือ fold)

- [x] สวิตช์/สถานะ `vatRegistered` (จด VAT แล้วหรือยัง) — เก็บไว้โชว์บริบท
- [x] โหมดรายได้เข้า P&L: ก่อน VAT (แนะนำ) / รวม VAT
- [x] ช่องทางที่เปิดใช้ (ถ้าปิด Shopee ชั่วคราว ไม่บังคับในสถานะวัน)
- [x] อีเมลที่คาดว่าจะรับรายงาน (เตรียม P2)

### P1.8 เช็ค P1 ปิดเฟส

- [x] สูตร VAT ตรวจด้วยตัวเลขตัวอย่าง (เช่น 107 → ฐาน 100 · VAT 7)
- [x] รวม 3 ช่อง + หน้าร้านถูกต้อง
- [x] บันทึกแล้วรีเฟรชยังอยู่
- [ ] เคสสิทธิ์ A–D ผ่าน
- [x] bump `APP_BUILD` → **332**
- [x] ไม่มีโค้ด Excel import ในโมดูลนี้

---

## P2 — เชื่อม API เมล (Gmail ก่อน)

### P2.1 เตรียม Google Cloud / OAuth

- [ ] สร้าง OAuth client (Web) สำหรับโปรเจกต์ Firebase/GCP ของร้าน
- [x] Scope อ่านอย่างเดียว เช่น Gmail readonly
- [x] Redirect URI ไป Cloud Function / หน้า owner callback
- [x] Client secret อยู่เฉพาะ Functions config / Secret Manager — ไม่ลง repo · ไม่ลง Firestore แบบ public
- [ ] เอกสารภายใน: ขั้นตอนเชื่อมเมลสำหรับเจ้าของร้าน (สั้น ๆ ในเช็คลิสหรือ ops note)

### P2.2 Cloud Functions

- [x] `vatMailOAuthStart` — คืน URL เชื่อมบัญชี (callable · owner only)
- [x] `vatMailOAuthCallback` — รับ code · แลก token · บันทึก
- [x] `vatMailDisconnect` — ลบ token · owner only
- [x] `vatMailSync` — ดึงเมลตามกฎ · owner only (หรือ scheduled + ยังเขียนได้เฉพาะระบบหลังตรวจ owner เชื่อมแล้ว)
- [x] ทุกฟังก์ชัน: ถ้าไม่ใช่ owner → `HttpsError permission-denied`
- [x] ไม่ส่ง refresh token กลับไปที่ client
- [x] client รู้แค่สถานะ: เชื่อมแล้วหรือยัง · อีเมลที่เชื่อม · sync ล่าสุดเมื่อไหร่

### P2.3 เก็บ token (owner-only)

```
meta/mailOAuth          // หรือ meta/vatMailOAuth
  provider: "gmail"
  email: string
  refreshToken: string   // ห้ามลง client
  scope: string
  connectedAt: number
  connectedBy: string
  lastSyncAt?: number
  lastSyncError?: string
```

- [x] rules: อ่าน/เขียน `isOwner()` เท่านั้น — **ห้าม** ตกกฎ `meta` ที่ `isStaff()` อ่านได้
- [ ] พิจารณาเข้ารหัสเพิ่ม หรือเก็บใน Secret Manager ถ้าร้านต้องการเข้มขึ้น (ทางเลือก)
- [x] disconnect ลบ token จริง

### P2.4 กฎค้นหาเมลต่อช่องทาง

ใน `meta/vatSalesSettings` หรือแยก:

```
mailRules: {
  shopee:  { fromIncludes: [], subjectIncludes: [], label?: string, enabled: boolean }
  grab:    { … }
  lineman: { … }
}
```

- [x] UI ตั้งค่า from/subject ต่อช่องทาง — owner only
- [x] ค่าเริ่มต้นแนะนำตามเมลจริงของร้าน (กรอกตอน onboard)
- [ ] ปุ่ม “ทดสอบค้นหา” แสดงจำนวนเมลที่ match ช่วงล่าสุด (ไม่โชวยอด)
- [x] จำกัดช่วง sync แรก (เช่น 14–31 วันย้อนหลัง) กันดึงทั้งกล่อง

### P2.5 เก็บ raw เมล

```
platformEmailReports/{id}
  channel: shopee | grab | lineman | unknown
  provider: gmail
  messageId: string          // idempotent
  threadId?: string
  receivedAt: number
  internalDate?: number
  subject: string
  from: string
  snippet?: string
  rawText?: string
  rawHtml?: string
  reportDateGuess?: string   // YYYY-MM-DD ถ้าเดาได้จาก subject
  parseStatus: pending | ok | fail | confirmed | ignored
  parseError?: string
  parsed?: { … }             // เติมใน P3
  parserVersion?: string
  syncedAt: number
```

- [x] เขียนด้วย Admin SDK จาก Functions เป็นหลัก (client อ่านได้อย่างเดียว หรือไม่เขียน raw จาก browser)
- [x] rules อ่าน: `isOwner()` · เขียนจาก client: ปิดหรือแคบมาก
- [x] unique ตาม `messageId` — sync ซ้ำไม่สร้างซ้ำ
- [x] เก็บ raw แม้ parse ยังไม่ทำ
- [x] ไม่ลบ raw อัตโนมัติเมื่อ parse ผ่าน

### P2.6 UI กล่องรายงานแพลตฟอร์ม

- [x] แท็บ/หน้าย่อยใน `/vat-sales/`: **ตารางรายวัน** | **กล่องเมล** | **ตั้งค่า**
- [x] สถานะการเชื่อม Gmail + ปุ่มเชื่อม / ตัดการเชื่อม
- [x] ปุ่ม “ซิงก์เมลตอนนี้”
- [x] รายการเมล: วันรับ · ช่องทาง · subject · parseStatus
- [x] กรอง: ช่องทาง · สถานะ · ช่วงวันที่
- [x] เปิดดู raw ย่อได้ (owner) — ระวังข้อมูลส่วนตัวในเมล
- [x] ทำเครื่องหมาย `ignored` ได้ (เมลไม่ใช่รายงานยอด)
- [x] พนักงานไม่เห็นแท็บนี้ทั้งหมด

### P2.7 Sync อัตโนมัติ (ถ้าทำ)

- [ ] Scheduled function วันละหลายรอบ (เช่น หลังเที่ยง / ค่ำ — ตามเวลาเมลร้าน)
- [x] ทำงานได้เฉพาะเมื่อมี OAuth เชื่อมแล้ว
- [x] บันทึก `lastSyncAt` / `lastSyncError`
- [x] ไม่ push รายละเอียดยอดให้พนักงาน

### P2.8 เช็ค P2 ปิดเฟส

- [x] เชื่อม Gmail สำเร็จด้วยบัญชีเจ้าของ
- [x] token ไม่โผล่ใน Network tab ของหน้าเว็บ
- [x] sync แล้วมีเอกสารใน `platformEmailReports`
- [x] sync ซ้ำไม่ซ้ำ `messageId`
- [x] เคสสิทธิ์ A–G ที่เกี่ยวข้องผ่าน
- [x] Outlook ยังไม่ทำ (ไป P6)

---

## P3 — Parser ยอดขายรายวัน

### P3.1 กรอบ parser ร่วม

- [ ] อินเทอร์เฟซร่วม: `parsePlatformEmail(raw) → ParsedPlatformReport | fail`
- [ ] `ParsedPlatformReport`:
  - `reportDate: YYYY-MM-DD`
  - `grossInclusive: number` (บังคับ)
  - `fee?: number`
  - `netTransfer?: number`
  - `orderCount?: number`
  - `currency: "THB"`
  - `confidence: "high" | "medium" | "low"`
  - `warnings: string[]`
- [ ] `parserVersion` ต่อช่องทาง (เช่น `grab-daily-v1`)
- [ ] หน่วยทดสอบด้วยตัวอย่างเมลจริงที่ sanitize แล้ว (เก็บใน `testdata/` ไม่มีข้อมูลส่วนตัว)
- [ ] ถ้า HTML เปลี่ยน → fail ชัด · ไม่เดายอดมั่ว

### P3.2 ลำดับช่องทาง

- [ ] **P3a** ช่องทางที่เมลร้านเสถียรสุด (เลือกตอนลงมือ: Grab หรือ LINE MAN)
- [ ] **P3b** ช่องทางที่ 2
- [ ] **P3c** ShopeeFood
- [ ] แต่ละช่องมีเช็คลิสย่อยด้านล่างครบก่อนขึ้นช่องถัดไป

### P3.3 ต่อช่องทาง (คัดลอกเช็คทีละตัว)

#### Grab

- [ ] กฎ from/subject จับเมลประจำวันได้
- [ ] parse วันที่รายงานถูกต้อง (Bangkok)
- [ ] parse ยอดลูกค้า / ยอดขายรวม VAT
- [ ] parse fee/GP ถ้ามีในเมล
- [ ] parse ยอดโอนสุทธิถ้ามี
- [ ] fixture ทดสอบอย่างน้อย 2 รูปแบบ (ถ้าเคยเปลี่ยนเทมเพลต)
- [ ] เอกสารสั้น: ฟิลด์ไหนในเมล = ฟิลด์ไหนในระบบ

#### LINE MAN

- [ ] (ชุดเดียวกับ Grab)

#### ShopeeFood

- [ ] (ชุดเดียวกับ Grab)

### P3.4 คิว “รอตรวจ” + ยืนยันเข้าตาราง

- [ ] เมล `parseStatus = ok` โชว์ในคิวรอตรวจ พร้อมตัวเลขที่ parse ได้
- [ ] เจ้าของแก้ตัวเลขก่อนยืนยันได้
- [ ] กดยืนยัน → เขียนเข้า `dailySales/{reportDate}` ช่องทางนั้น
- [ ] ตั้ง `sources.{channel} = "email"` + เก็บ `emailId`
- [ ] `parseStatus → confirmed`
- [ ] เมล `fail` ค้างในคิว พร้อม `parseError` · เปิด raw ได้
- [ ] ปุ่ม “กรอกมือแทน” จากคิว fail
- [ ] **ไม่** overwrite วัน `dailySales.status = confirmed` โดยอัตโนมัติ
- [ ] ถ้าวันนั้นมีค่ายูช่องทางอยู่แล้ว → แสดงส่วนต่าง · ให้เลือกรับทับ / เก็บของเดิม
- [ ] เมลหนึ่งฉบับไม่ยืนยันซ้ำเป็นสองแถว

### P3.5 ขอบเขตตัวเลขที่ต้องระวัง

- [ ] ส่วนลดโปรแพลตฟอร์ม / คูปอง — บันทึกตามที่เมลรายงานยอดลูกค้าจริง (อย่าสมมติ)
- [ ] ค่าส่งที่ลูกค้าจ่าย — ตัดสินใจว่ารวมใน grossInclusive ตามรายงานแพลตฟอร์มหรือไม่ แล้วเขียนใน docs ช่องทาง
- [ ] ปรับยอดภายหลัง (correction mail) — รองรับเป็นคิวแยกหรือหมายเหตุ (อย่างน้อยไม่เงียบ)
- [ ] ยอด 0 วันไม่มีออเดอร์: แยก “เมลยืนยันศูนย์” กับ “ยังไม่มีเมล”

### P3.6 เช็ค P3 ปิดเฟส

- [ ] อย่างน้อย 1 ช่องทาง ไหลครบ: เมล → parse → ยืนยัน → โผล่ตารางรายวัน
- [ ] fixture เทสผ่าน CI หรือสคริปต์ท้องถิ่น
- [ ] เคสสิทธิ์ผ่าน
- [ ] พนักงานยังไม่เห็นคิวเมล / ตัวเลข

---

## P4 — รวมยอดร้านรายวัน · สถานะวัน · แจ้งเตือน

### P4.1 สถานะวัน (derived + เก็บถาวร)

สถานะที่แสดง:

| สถานะ | ความหมาย |
|--------|----------|
| `missing_mail` | ถึงเวลาแล้วแต่ยังไม่มีเมลช่องทางที่เปิดใช้ |
| `pending_review` | มีเมล parse แล้วรอเจ้าของยืนยัน |
| `incomplete` | มีบางช่องทางแล้ว ขาดบางช่อง / ขาดหน้าร้าน |
| `ready` | ครบตามช่องทางที่เปิด · ยังไม่ confirm วัน |
| `confirmed` | เจ้าของยืนยันวันแล้ว |
| `parse_error` | มีเมลแต่ parse ไม่ผ่าน |

- [ ] คำนวณสถานะจากเมล + `dailySales` + `channelsEnabled`
- [ ] แสดงสี/ป้ายในตารางรายวัน
- [ ] กรองตารางตามสถานะได้
- [ ] นับจำนวนวันในเดือนต่อสถานะ (สรุปหัวหน้า)

### P4.2 Dashboard ขาดรายงาน

- [ ] บล็อก “ต้องจัดการ”: วันขาดเมล · รอตรวจ · parse พัง
- [ ] กดแล้วกระโดดไปวัน/เมลนั้น
- [ ] แสดงเฉพาะเจ้าของ
- [ ] ไม่ผสมเข้าหน้า ledger พนักงาน

### P4.3 แจ้งเตือนเจ้าของ

- [ ] เงื่อนไข: หลังเวลาที่ตั้ง (เช่น 10:00 น. วันถัดไป) ยังขาดเมลเมื่อวาน
- [ ] เงื่อนไข: parse fail ใหม่
- [ ] ส่งผ่านระบบ push ที่มีอยู่ — **เฉพาะ owner subscription**
- [ ] ไม่ส่งเข้า staff
- [ ] ข้อความไม่โชวยอดละเอียดใน notification ถ้าไม่จำเป็น (หรือโชว์ได้เพราะเป็นเจ้าของ — ตัดสินใจแล้วบันทึก)
- [ ] ตั้งค่าเปิด/ปิดแจ้งเตือนใน `vatSalesSettings`

### P4.4 ยอดรวมและความถูกต้อง

- [ ] `deliveryGross` = ผลรวม 3 ช่อง (grossInclusive)
- [ ] `storefrontGross` แยก
- [ ] `totalGross` = delivery + storefront
- [ ] VAT คิดจาก `totalGross` (หรือแยก VAT ต่อช่องทางแล้วรวม — เลือกหนึ่งแล้วใช้ตลอด; แนะนำคิดจากรวมร้านเพื่อเลี่ยงเศษสตางค์)
- [ ] แสดงทั้งยอดลูกค้าและยอดโอนสุทธิคนละคอลัมน์/fold (อย่าปน)
- [ ] สรุปเดือน: ยอดลูกค้า · fee รวม · โอนสุทธิรวม · VAT รวม

### P4.5 เช็ค P4 ปิดเฟส

- [ ] สถานะวันเปลี่ยนถูกต้องเมื่อซิงก์เมล / ยืนยัน / ขาดช่อง
- [ ] dashboard แสดงวันปัญหา
- [ ] push ถึงเจ้าของเท่านั้น (เทสด้วยบัญชี staff คู่)
- [ ] เคสสิทธิ์ H ผ่าน

---

## P5 — ปิดเดือน → P&L + รายงาน VAT

### P5.1 สรุปเดือน

- [ ] หน้า/แผง “ปิดเดือน” ใน `/vat-sales/` เลือก `YYYY-MM`
- [ ] สรุปเฉพาะวัน `confirmed` (แสดงชัดว่าวันร่างไม่นับ)
- [ ] แสดงจำนวนวัน confirmed / วันในเดือน / วันยังไม่พร้อม
- [ ] ยอดรวม: เดลิเวอรี่แยกช่อง · หน้าร้าน · รวมร้าน · ฐานภาษี · VAT
- [ ] คำเตือนถ้ายังมีวัน `missing_mail` / `pending_review`

### P5.2 สะพานเข้า `monthlyIncome`

- [ ] คำนวณค่าเสนอตาม `pnlIncomeMode` (`exVat` แนะนำ = `vatBase` รวมเดือน)
- [ ] แสดงค่าปัจจุบันใน `monthlyIncome/{month}` เทียบค่าเสนอ
- [ ] ปุ่ม “ใส่เป็นรายได้เดือนนี้” → เขียน `monthlyIncome` หลัง confirm dialog
- [ ] บันทึก audit เบา ๆ: ใครกด · เมื่อไหร่ · ยอดจากวัน confirmed เท่าไร
- [ ] **ห้าม** job อัตโนมัติเขียน `monthlyIncome` จากเมลหรือ POS
- [ ] ไม่แก้ domain policy: POS ยังไม่เขียน books ตรง ๆ
- [ ] หลังเขียนแล้วลิงก์ไป `/pnl/` ให้เจ้าของตรวจงบ

### P5.3 รายงาน VAT รายเดือน

- [ ] หน้าหรือส่วน: ยอดขายรวม VAT · ฐานภาษี · VAT 7% · แยกเดลิเวอรี่/หน้าร้าน
- [ ] ถ้า `vatRegistered = false` แสดงข้อความว่าใช้เพื่อประมาณการ / จัดการภายใน (ไม่ใช่แบบฟอร์มยื่นอัตโนมัติ)
- [ ] ไม่สร้างไฟล์ Excel เป็นทางหลัก (ถ้าเจ้าของอยากได้ตัวเลขบนจอ/พิมพ์หน้าเว็บก่อน)
- [ ] owner-only ทั้งหมด

### P5.4 ความสัมพันธ์กับงบกำไรขาดทุน

- [ ] รายจ่ายยังมาจาก ledger + ownerBooks ตามเดิม
- [ ] รายได้มาจากการยืนยันปิดเดือน
- [ ] กลางเดือน: หน้า vat-sales โชว์ “รายได้ชั่วคราวจากวันที่ยืนยันแล้ว” ได้ — แต่ P&L หลักยังเป็นค่าใน `monthlyIncome`
- [ ] เอกสารใน UI อธิบายว่าทำไมตัวเลขกลางเดือนอาจไม่เท่าปิดงบ

### P5.5 เช็ค P5 ปิดเฟส

- [ ] ปิดเดือนทดลอง 1 เดือนด้วยข้อมูลจริงหรือจำลอง
- [ ] `/pnl/` แสดงรายได้ตรงกับที่ยืนยัน
- [ ] พนักงานที่เปิด `/pnl/` ได้ยัง **ไม่เห็น** แหล่งย่อย Shopee/Grab/LINE MAN จากโมดูลนี้ (เห็นแค่รายได้รวมตามสิทธิ์ pnl เดิมเท่านั้น)
- [ ] เคสสิทธิ์ผ่าน

> หมายเหตุ: `/pnl/` อาจยังเป็นสิทธิ์มอบให้พนักงานได้ตามของเดิม — **ห้าม** ฝังรายละเอียดช่องทางเดลิเวอรี่ลงหน้า P&L ถ้าพนักงานอาจเห็น  
> รายละเอียดช่องทางอยู่ที่ `/vat-sales/` เท่านั้น

---

## P6 — ทางเลือก (หลังรายวันนิ่ง)

### P6.1 Outlook / Hotmail

- [ ] Microsoft Graph OAuth (Mail.Read)
- [ ] เก็บ token แยก provider ใน `meta/mailOAuth` หรือ doc แยก
- [ ] sync เข้า `platformEmailReports` โครงสร้างเดิม
- [ ] UI เชื่อมบัญชีที่สอง
- [ ] owner-only เหมือน Gmail

### P6.2 เมลสรุปรายสัปดาห์ / รายเดือน

- [ ] parse แยกจากรายวัน (`reportKind: daily | weekly | monthly`)
- [ ] ใช้หน้า “เทียบยอด” ไม่เขียนทับรายวันอัตโนมัติ
- [ ] แสดงส่วนต่างรายวันรวม vs สรุปแพลตฟอร์ม

### P6.3 Input VAT (ใบกำกับซื้อ)

- [ ] ถ้าจด VAT และต้องการเครดิตภาษีซื้อ — ออกแบบ collection แยก
- [ ] ผูกหลักฐานรูป (`evidencePhotos`) ได้
- [ ] owner-only
- [ ] ไม่ปนกับ ledger พนักงานโดยไม่ตั้งใจ

### P6.4 Foodpanda / ช่องทางอื่น

- [ ] เพิ่ม channel ใน type + UI + mail rules + parser เมื่อร้านใช้จริง
- [ ] ไม่ทำล่วงหน้าถ้ายังไม่มีเมล

---

## P7 — ขัดเกลาหลังนิ่ง

- [ ] Audit log การแก้ยอด / ยืนยันวัน / ปิดเดือน
- [ ] เก็บ raw เมลตามนโยบายระยะเวลา (เช่น 12–24 เดือน) + งาน prune owner-triggered
- [ ] ค้นหาวัน/ยอดในตารางเร็วขึ้น
- [ ] คู่มือสั้นในแอปสำหรับเจ้าของ: เชื่อมเมล · ยืนยันวัน · ปิดเดือน
- [ ] ระบบสุขภาพ parser: นับ fail rate ต่อช่องทาง
- [ ] เมื่อแพลตฟอร์มเปลี่ยนเทมเพลต → แจ้งเจ้าของว่าต้องอัป parser

---

## โมเดลข้อมูล (รวม)

```
dailySales/{YYYY-MM-DD}
platformEmailReports/{id}
meta/vatSalesSettings      // owner-only · ห้าม staff อ่าน
meta/vatMailOAuth          // owner-only · มี refresh token · ห้าม staff อ่าน
```

**Firestore:** ทุกอันด้านบน `isOwner()` เท่านั้น  
**Functions:** Admin SDK เขียนรายงานเมล + ตรวจ caller owner สำหรับ callable

---

## แผนไฟล์ที่คาดว่าจะแตะ (ตอนลงมือ)

| พื้นที่ | ไฟล์โดยประมาณ |
|---------|----------------|
| Lib | `src/lib/vat-sales.ts`, `vat-sales-mail.ts`, `vat-sales-vat.ts` |
| UI | `src/app/vat-sales/page.tsx`, components ใต้ `src/components/vat-sales/` |
| นำทาง | `src/app/more/page.tsx` (การ์ด isOwner) |
| Rules | `firestore.rules` |
| Functions | `functions/vat-mail-*.js` + export ใน `functions/index.js` |
| Docs | ไฟล์เช็คลิสนี้ · อัปสถานะเฟสเมื่อปิด |
| Build | bump `APP_BUILD` / version เมื่อมี UI |

- [ ] ไม่ใส่คีย์ใหม่ใน `src/lib/permissions.ts`
- [ ] ไม่เพิ่มเมนูใน dock พนักงาน
- [ ] ไม่สร้าง Excel import path

---

## ความเสี่ยงและทางแก้ (เช็คตอนออกแบบ/รีวิว)

| ความเสี่ยง | ทางแก้ในเช็คลิส | ตรวจแล้ว |
|------------|-----------------|----------|
| พนักงานเห็นยอดแพลตฟอร์ม | owner gate + rules + ไม่ใส่ perm | ☐ |
| token เมลรั่ว | Functions + meta owner-only + ไม่คืน token | ☐ |
| ยอดลูกค้า ≠ เงินเข้า | แยก gross / fee / net | ☐ |
| เทมเพลตเมลเปลี่ยน | raw + parserVersion + คิว fail | ☐ |
| เศษสตางค์ VAT | ฟังก์ชันปัดเดียว · คิดจากรวมร้าน | ☐ |
| overwrite วันปิดแล้ว | กัน auto ทับ confirmed | ☐ |
| P&L กลางเดือนเพี้ยน | ปิดเดือนมือ · แสดงสถานะชั่วคราว | ☐ |
| timezone ผิดวัน | Bangkok date key ทุกชั้น | ☐ |
| เมลเข้าช้า | สถานะ missing_mail + แจ้งเตือนเจ้าของ | ☐ |
| Excel กลับมาโดยไม่ตั้งใจ | ตัดจากแผน · รีวิว PR กัน | ☐ |

---

## อ้างอิงระบบเดิม

| ของเดิม | ใช้ยังไง |
|---------|----------|
| `/pnl/` + `monthlyIncome` | รับยอดหลังปิดเดือน (P5) — ไม่ฝังรายละเอียดช่องทางถ้าพนักงานอาจเห็น P&L |
| ledger / ownerBooks | รายจ่ายอย่างเดียว |
| `posSales` | suggest หน้าร้าน (P1) |
| `/menu/` · `/pos-sales/` | แบบอย่าง owner gate + more card |
| `meta/foodstoryAuth` | แบบอย่าง meta secret owner-only |
| `docs/pos-domain-policy.md` | ห้าม POS เขียน monthlyIncome ตรง ๆ |
| push ที่มีอยู่ | แจ้งเตือนเจ้าของ (P4) |

---

## คิวทำถัดไป (ลงมือ)

1. **P1.1–P1.4** types + rules + route + การ์ด owner  
2. **P1.5–P1.8** ตารางรายวัน + VAT + POS suggest + เทสสิทธิ์  
3. **P2** Gmail OAuth + กล่องเมล  
4. **P3a** parser ช่องทางแรก → ยืนยันเข้าตาราง  
5. **P3b–P3c** ช่องทางที่เหลือ  
6. **P4** สถานะวัน + แจ้งเตือน  
7. **P5** ปิดเดือน + VAT เดือน  
8. **P6–P7** ตามความต้องการหลังใช้งานจริง  

---

## Changelog เอกสาร

| วันที่ | รายการ |
|--------|--------|
| 2026-07-28 | P0 เช็คลิสแรก (สั้น) |
| 2026-07-28 | ขยายฉบับยาว: ย่อย P1–P7 · ตารางสิทธิ์ · ความเสี่ยง · แผนไฟล์ · คำศัพท์ |
| 2026-07-28 | **P2 ลงมือ** — Gmail OAuth callables · กล่องเมล · mailRules · build 333 |
| 2026-07-28 | **P1 ลงมือ** — lib `vat-sales` · rules owner-only · `/vat-sales/` · การ์ด more · POS suggest · build 332 |
