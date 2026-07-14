# TellTea

บัญชีร้าน — แทน Google Sheet  
เจ้าของโอนเงินเข้า · พนักงานบันทึกเงินออก · ดูยอดคงเหลือ

## ลิงก์แอป

**https://telltea-shop.web.app**

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

TellTea ใช้ **auth bridge** ถาวรบน  
`https://mypeer-501909.firebaseapp.com/telltea-auth.html`

OAuth จบที่ firebaseapp.com (redirect URI ที่ Google รับอยู่แล้ว) แล้วส่ง **ticket สั้นๆ**
กลับมา TellTea — ไม่ยัด Google ID token ยาวๆ ใน URL (มือถือตัด hash บ่อย)

เปิดด้วย **Safari / Chrome** โดยตรง — หลีกเลี่ยง LINE / Facebook in-app browser

ไฟล์ bridge อยู่ใน repo P-Note (`frontend/telltea-auth.html`)

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

## แจ้งเตือนยอดต่ำ

เจ้าของตั้งเกณฑ์ได้ที่ **อื่นๆ → แจ้งเตือนยอดต่ำ**

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
