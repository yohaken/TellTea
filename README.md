# TellTea

บัญชีร้าน — แทน Google Sheet  
เจ้าของโอนเงินเข้า · พนักงานบันทึกเงินออก · ดูยอดคงเหลือ

## ลิงก์แอป

**https://telltea-bo.web.app**

## บทบาท

| บทบาท | แท็บหลัก | เพิ่มเติม |
|--------|----------|-----------|
| staff | บัญชี · จ่าย · สต็อก | — |
| owner | บัญชี · จ่าย · สต็อก · อื่นๆ | โอนเข้า · นำเข้า Excel · พนักงาน |

เจ้าของ (`yohaken@gmail.com`) เข้าได้ทุกหน้าเพื่อเทส และใช้บัญชีรายวันเหมือนพนักงานได้

สต็อกเป็นแบบเบาๆ (ชื่อ / จำนวน / +−) ไม่ใช่ระบบคลังหรือภาษี

## นำเข้าจาก Excel

รองรับไฟล์รูปแบบเดียวกับ `รายวันเดิมรายการ.xlsx`

คอลัมน์: **วันที่ · รายการ · เข้า · ออก · คงเหลือ · type** (`cogs` / `sga` / `asset`)

- ในแอป: เมนู **นำเข้า** (เจ้าของ)
- หรือรันสคริปต์: `GOOGLE_APPLICATION_CREDENTIALS=... node scripts/import-xlsx.cjs`

ข้อมูลเดิมถูกนำเข้าแล้ว **1,498 รายการ** · คงเหลือ **36,234.81**

## ล็อกอินมือถือ

### สมาชิก (`/claim`, `/me`) — TellTea เอง
- **เบอร์มือถือไทย + OTP** เป็นทางหลัก (06/08/09)
- **Google** ใช้ Firebase `signInWithRedirect` บน `telltea-bo.web.app` (same-origin)
- **ไม่พึ่ง** P-Note / `telltea-auth.html` / `loginTickets` สำหรับสมาชิก
- โค้ด: `src/lib/member-auth.ts` · `src/lib/phone-auth.ts`

เปิดด้วย **Safari / Chrome** — LINE / Facebook in-app browser มักพัง OAuth/reCAPTCHA

### พนักงาน (หลังร้าน `/login`)
- **ทางหลัก:** same-origin Google — เดสก์ท็อปใช้ popup · มือถือใช้ `signInWithRedirect` (เหมือนสมาชิก)
- **ไม่พึ่ง** cross-domain `telltea-auth.html` + Firestore ticket เป็นค่าเริ่มต้น (เคย timeout บ่อยตอนพนักงานเข้าใช้)
- **ทางสำรอง legacy:** `NEXT_PUBLIC_FORCE_AUTH_BRIDGE=1` ยังชี้ไป  
  `https://mypeer-501909.firebaseapp.com/telltea-auth.html`  
  และแลกตั๋วผ่าน Cloud Function `exchangeLoginTicket` (Admin SDK) ก่อน แล้วค่อยอ่าน Firestore ฝั่ง client
- โค้ด: `src/lib/auth.tsx` · `functions/auth-login-ticket.js`

### โปรเจกต์ร่วม (TaxTag ฯลฯ)

แอปร้าน TellTea ใช้ Firebase project `mypeer-501909`  
ถ้าแออื่น (เช่น `taxtag.web.app`) ใช้โปรเจกต์เดียวกัน **ห้าม deploy `firestore.rules` จาก repo อื่น** — จะทับกฎทั้งร้าน  
กฎ TaxTag (`taxtag/{uid}`) รวมไว้ใน `firestore.rules` ของ repo นี้แล้ว  
Deploy TaxTag แค่ hosting: `firebase deploy --only hosting:taxtag`

ก่อนขึ้น production ทุกครั้ง CI รัน `npm run test:firestore-rules`  
ถ้าขาด collection สำคัญ (ledger / staff / taxtag …) จะ **fail deploy**

สร้างแอปใหม่บนโปรเจกต์เดียวกัน → ดู  
`scripts/templates/SHARED_FIREBASE_CHECKLIST.md`  
และใช้ `scripts/templates/firebase.hosting-only.json`

### เทสก่อน deploy

```bash
npm run test:firestore-rules
node scripts/smoke-mobile.mjs
```

## แจ้งเตือนเจ้าของ (LINE)

ตั้งค่าที่ **อื่นๆ → ตั้งค่าโมดูล → แจ้งเตือนเจ้าของ (LINE)** — ส่งเข้า LINE ส่วนตัวเท่านั้น

1. **แจ้งทันทีเมื่อเข้าเงื่อนไข** — เช่น ยอดคงเหลือพนักงานต่ำกว่าเกณฑ์ ส่ง LINE ทันทีในช่วงเวลาที่ตั้งไว้
2. **สรุปรายวัน** — เปิด/ปิดได้ · ติ๊กรายการด้านล่างแล้วบันทึก (ยอดคงเหลือ · แจ้งบิล · ยอดขายวันก่อน · สมาชิก)

ต้องมี LINE Official + Messaging API แล้วใส่ Channel access token + User ID

- ป็อปอัปในแอปเมื่อคงเหลือต่ำกว่าเกณฑ์
- แจ้งเตือนถึงมือถือ (Web Push) เมื่อเปิดสิทธิ์บนเครื่องเจ้าของ
- iPhone: เพิ่ม TellTea ไปยังหน้าจอโฮมก่อน แล้วค่อยเปิดแจ้งเตือน

## พัฒนาในเครื่อง

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Deploy

Push ไป `main` → GitHub Actions deploy Hosting + Firestore rules

### เวอร์ชันขึ้นเว็บ (อย่าให้ค้างของเก่า)

| เช็ค | ความหมาย |
|------|----------|
| `https://telltea-bo.web.app/version.json` | build หลังบ้านจริงบน CDN |
| ป้ายเวอร์ชันในแอป (`4.xxx`) | build ของ JS ที่แท็บนั้นโหลดอยู่ |
| CI `test:app-build-bump` | แก้ UI แล้วต้อง bump `APP_BUILD` |
| CI `smoke:live-version` | หลัง deploy บังคับให้ live ≥ build ใน commit |

ถ้าแก้หน้าจอ/JS แล้ว: **bump `src/lib/version.ts` → `APP_BUILD`** ทุกครั้ง  
แท็บที่เปิดค้างจะเห็นแบนเนอร์อัปเดต และรีเฟรชเองเมื่อว่างกรอก (~90 วินาที) — หรือ Settings → บังคับอัปเดตทันที  
รายละเอียด: `docs/deploy-version.md`  
เบิกล่วงหน้า → หักเงินเดือน: `docs/payroll-advance-checklist.md`
