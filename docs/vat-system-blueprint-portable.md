# VAT Daily Sales — Portable Blueprint (ถอดโครงสร้างคำสั่งทั้งก้อน)

> ถอดจากงานที่ทำบน TellTea โดยผิดแอป · ใช้เป็นสเปกพกไปลงแอปที่ถูก  
> วันที่ถอด: 2026-07-28 · สาขาอ้างอิง: `cursor/vat-daily-sales-checklist-deaf` · PR #132  
> **อัปเดต:** รวมเข้า **บช.เจ้าของ** (`OwnerBooksModeSwitch`: เงินออก ↔ ยอดขาย/VAT) · ตารางวัน **super slim**  
> **ไม่ผูก Excel** · **owner-only ทั้งก้อน** · เดลิเวอรี่จาก **API เมล** เท่านั้น

---

## 1) เป้าหมายธุรกิจ (1 บรรทัด)

ยอดขายรายวัน = ShopeeFood + Grab + LINE MAN + หน้าร้าน → VAT 7% จากยอดลูกค้า (inclusive) → ปิดเดือนใส่รายได้ P&L ด้วยมือ · พนักงานห้ามเห็น

---

## 2) กฎเหล็ก (ห้ามหัก)

1. **Owner-only** — UI / route / Firestore / Functions / push / token เมล  
2. **ห้าม** ใส่ `PERMISSION_KEYS` (กันมอบสิทธิ์พนักงาน)  
3. **VAT ฐาน** = ยอดลูกค้าจ่าย ÷ 1.07 · **ไม่ใช่** ยอดโอนสุทธิ  
4. แยกฟิลด์: `grossInclusive` ≠ `fee` ≠ `netTransfer`  
5. เมลสัปดาห์/เดือน → **เทียบยอดเท่านั้น** · ห้ามทับตารางรายวัน  
6. POS suggest หน้าร้านได้ · **ห้าม** POS เขียน `monthlyIncome` ตรง ๆ  
7. ปิดเดือน = ยืนยันมือครั้งเดียว → `monthlyIncome`

---

## 3) เฟส (ลำดับทำ)

| เฟส | คำสั่งสั้น | สิ่งที่ได้ |
|-----|-----------|-----------|
| **P0** | ตกลงขอบเขต + owner-only | docs/checklist |
| **P1** | types · rules · ตารางวัน · VAT สูตร · POS suggest | `/vat-sales/` แท็บวัน |
| **P2** | Gmail OAuth · sync · กล่องเมล | `platformEmailReports` |
| **P3** | parse รายวัน · คิวยืนยันเข้า `dailySales` | parser + confirm |
| **P4** | สถานะวัน · dashboard · แจ้งเตือน owner | alerts schedule |
| **P5** | ปิดเดือน → `monthlyIncome` + VAT เดือน | แท็บปิด |
| **P6** | Outlook · เทียบสัปดาห์/เดือน · ภาษีซื้อ | แท็บเทียบ/ซื้อ |
| **P7** | audit · prune raw · ค้นหา · คู่มือ · parser health | แท็บประวัติ |

**ยังไม่ทำ:** Foodpanda (รอเมลจริง) · ปรับ parser จากเมลร้านจริง · deploy (ไว้ทีหลังได้)

---

## 4) UI แผนที่ (แท็บย่อ)

Route: `/vat-sales/` · สลับจาก `/owner-books/` (บช.เจ้าของ) · prefix ใน AppShell · การ์ดแยกใน `/more/` ถูกยุบเข้าบัญชีเจ้าของ

| แท็บ | ย่อ | งาน |
|------|-----|-----|
| daily | **วัน** | ตาราง slim: `ว · Sp · Grab · LM · ร้าน · รวม · ฐาน · VAT · สถ · …` |
| mail | **เมล** | API Gmail/Outlook (ID+Secret) · ซิงก์ · Parse · ยืนยันเข้าวัน |
| recon | **เทียบ** | เมลสัปดาห์/เดือน vs รวมวัน · ไม่ทับ |
| input | **ซื้อ** | `vatInputInvoices` · VAT สุทธิ |
| close | **ปิด** | ใส่รายได้เดือน → P&L |
| audit | **ประวัติ** | `vatSalesAudit` |

คอลัมน์ตารางวัน: `ว · Sp · Grab · LM · ส่ง · ร้าน · รวม · ฐาน · VAT · สถานะ · บ. · …`  
สถานะย่อ: `OK · พร้อม · ขาดเมล · รอตรวจ · fail · ไม่ครบ · —`

---

## 5) โมเดล Firestore (owner-only ทุกอัน)

```
dailySales/{YYYY-MM-DD}
  dateKey, storefront{grossInclusive,fee,netTransfer},
  delivery{shopee,grab,lineman},
  storefrontGross, deliveryGross, totalGross, vatBase, vatOutput,
  status: draft|confirmed,
  sources{storefront,shopee?,grab?,lineman?}: manual|pos_suggest|email,
  emailRefs{shopee?,grab?,lineman?}, note,
  confirmedAt, confirmedBy, updatedAt, updatedBy

platformEmailReports/{id}
  channel, provider: gmail|outlook, messageId, receivedAt,
  subject, from, snippet, rawText, rawHtml,
  reportDateGuess, reportKind: daily|weekly|monthly,
  parseStatus: pending|ok|fail|confirmed|ignored,
  parseError, parserVersion, parsed{...}, syncedAt, rawPrunedAt?

vatInputInvoices/{id}
  dateKey, monthKey, vendor, description,
  grossInclusive, vatBase, vatInput, evidenceRef(evp:), note,
  createdAt/By, updatedAt/By

vatMonthCloses/{YYYY-MM}
  month, income, pnlIncomeMode, confirmedDays, totals,
  previousIncome, closedAt, closedBy

vatSalesAudit/{id}
  action: upsert_day|confirm_day|unconfirm_day|confirm_email|close_month|prune_mail_raw,
  dateKey, monthKey, summary, before, after, actor, at

meta/vatSalesSettings          // ตั้งค่าร้าน · mailRules · alerts
meta/vatMailOAuth              // Gmail refresh token (server)
meta/vatMailOAuthConfig        // Gmail clientId/secret/redirect
meta/vatMailOAuthState         // OAuth state ชั่วคราว
meta/vatMailOAuthOutlook       // Outlook token
meta/vatMailOAuthConfigOutlook
meta/vatMailOAuthStateOutlook
meta/vatSalesAlertState        // กัน spam push

monthlyIncome/{YYYY-MM}        // ของเดิม P&L — ปิดเดือนเขียนเข้า
```

**Rules แพทเทิร์น:**
```
match /dailySales/{id} { allow read, write: if isOwner(); }
match /platformEmailReports/{id} { allow read, write: if isOwner(); }
match /vatMonthCloses/{id} { allow read, write: if isOwner(); }
match /vatInputInvoices/{id} { allow read, write: if isOwner(); }
match /vatSalesAudit/{id} { allow read, write: if isOwner(); }
// meta docs ด้านบน: allow read เฉพาะ isOwner() · ห้ามตกกฎ isStaff() กว้าง
```

---

## 6) สูตรเงิน (ฟังก์ชันเดียวทั้งระบบ)

```
VAT_RATE = 0.07
roundMoney(n) = round 2 ทศนิยม
computeVatFromGross(grossInclusive) →
  vatBase = round(gross / 1.07)
  vatOutput = round(gross - vatBase)
sumDaily = delivery(shopee+grab+lineman) + storefront
```

P&L ปิดเดือนโหมดแนะนำ: **exVat** = ใส่ `vatBase` รวมวันที่ยืนยัน เป็นรายได้

---

## 7) Cloud Functions (exports)

| Export | ชนิด | งาน |
|--------|------|-----|
| `vatMailStatus` | callable | สถานะ Gmail |
| `vatMailOAuthStart` | callable | ได้ auth URL |
| `vatMailOAuthCallback` | HTTP | รับ code · เก็บ refresh |
| `vatMailDisconnect` | callable | ตัด Gmail |
| `vatMailSync` | callable | ดึงเมล → `platformEmailReports` |
| `vatOutlookStatus` | callable | สถานะ Outlook |
| `vatOutlookOAuthStart` | callable | auth URL |
| `vatOutlookOAuthCallback` | HTTP | callback |
| `vatOutlookDisconnect` | callable | ตัด |
| `vatOutlookSync` | callable | sync Graph |
| `vatSalesDailyAlert` | schedule | ~10:00 Bangkok เตือน owner |
| `vatSalesAlertCheck` | callable | ตรวจมือ |

**OAuth ตั้งค่า UI (slim):** ใส่แค่ **Client ID + Client Secret**  
Redirect คงที่ (copy ไปวางใน Google/Azure):
- Gmail → `…/vatMailOAuthCallback`
- Outlook → `…/vatOutlookOAuthCallback`  
Scope Outlook: `offline_access Mail.Read User.Read`

ทุก callable: `assertOwner` ก่อนทำงาน · token ไม่ออกจาก Functions

---

## 8) ไฟล์ที่ต้องพก (แมปพาธ)

### Lib
```
src/lib/vat-sales.ts              # types · VAT · dailySales CRUD · settings · POS suggest
src/lib/vat-sales-mail.ts         # Gmail client · reports · parse/confirm
src/lib/vat-sales-outlook.ts      # Outlook client helpers
src/lib/vat-sales-parse.ts        # heuristic Grab/LM/Shopee · reportKind
src/lib/vat-sales-status.ts       # day ops status · CHANNEL_SHORT
src/lib/vat-sales-close.ts        # month close → monthlyIncome
src/lib/vat-sales-reconcile.ts    # weekly/monthly vs daily sum
src/lib/vat-input.ts              # ภาษีซื้อ CRUD
src/lib/vat-sales-audit.ts        # append-only audit
src/lib/vat-sales-parser-health.ts
src/lib/vat-sales-mail-prune.ts   # ลบ raw เก่า (owner)
```

### UI
```
src/app/vat-sales/page.tsx
src/components/vat-sales/VatSalesMailPanel.tsx
src/components/vat-sales/VatSalesReconcilePanel.tsx
src/components/vat-sales/VatSalesInputVatPanel.tsx
src/components/vat-sales/VatSalesMonthClosePanel.tsx
src/components/vat-sales/VatSalesAuditPanel.tsx
src/components/vat-sales/VatSalesOwnerGuide.tsx
+ CSS บล็อก .vat-sales-* / .vat-api-* / .vat-map-*
+ more card (isOwner) + AppShell MORE_PREFIXES
```

### Functions / Rules / Tests / Fixtures
```
functions/vat-mail.js
functions/vat-mail-outlook.js
functions/vat-sales-alerts.js
functions/index.js          # export ทั้งชุด
firestore.rules             # collections + meta ด้านบน
scripts/test-vat-mail-parse.ts
scripts/test-vat-sales-p7.ts
testdata/vat-mail/*
docs/vat-daily-sales-checklist.md
```

### แตะไฟล์เดิม (integration)
```
src/app/more/page.tsx       # การ์ด owner
src/components/AppShell.tsx # /vat-sales prefix
src/lib/version.ts          # bump APP_BUILD เมื่อ ship UI
(ไม่แตะ permissions.ts)
```

---

## 9) คำสั่งทำทีละชั้น (สำหรับแอปใหม่)

```
P0  เขียน checklist + กฎ owner-only
P1  vat-sales.ts + rules dailySales/settings + page ตารางวัน + more card
P2  vat-mail.js + mail panel + meta oauth rules + sync
P3  vat-sales-parse.ts + confirm เข้า dailySales (daily only)
P4  vat-sales-status.ts + action chips + vat-sales-alerts.js
P5  vat-sales-close.ts + แท็บปิด + vatMonthCloses
P6  vat-mail-outlook.js + reconcile + vat-input + แท็บเทียบ/ซื้อ
P7  audit + prune + health/drift + ค้นหา/bulk confirm + คู่มือ slim
```

**Deploy เมื่อพร้อม (แอปที่ถูก):** rules → functions → hosting · ตั้ง OAuth client

---

## 10) Flow เจ้าของ (คู่มือ 3 ขั้น)

1. **เมล** — ตั้งค่า ID+Secret → เชื่อม → ซิงก์ → Parse → ยืนยันรายวันเข้าตาราง  
2. **วัน** — ตรวจสถานะพร้อม → ยืนยันวัน (หรือยืนยันทั้งชุด) · หน้าร้านดึง POS ได้  
3. **ปิด** — ดู VAT ขาย vs ซื้อ → ใส่รายได้เดือนเข้า P&L

เมลสัปดาห์/เดือน → แท็บ**เทียบ** เท่านั้น

---

## 11) สิ่งที่ตัดออก (อย่าพกไปแอปใหม่)

- Excel import เป็นทางหลัก  
- สิทธิ์พนักงาน / PERMISSION_KEYS ใหม่  
- รวมเดลิเวอรี่เข้า ledger พนักงาน  
- Foodpanda ล่วงหน้าไม่มีเมล  
- Auto ปิดเดือนจาก POS

---

## 12) อ้างอิงโค้ดต้นทาง (ผิดแอป — TellTea)

- Repo: `yohaken/TellTea`  
- Branch: `cursor/vat-daily-sales-checklist-deaf`  
- PR: https://github.com/yohaken/TellTea/pull/132  
- Live ที่ผิด: https://mypeer-501909.web.app/vat-sales/  

ถ้าต้องการ **ถอนออกจาก TellTea** (ปิด PR / revert main) บอกได้ — โครงสร้างด้านบนพกไปลงแอปที่ถูกได้ทันที
