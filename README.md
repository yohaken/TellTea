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

### เทสก่อน deploy

```bash
node scripts/smoke-mobile.mjs
```

## พัฒนาในเครื่อง

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Deploy

Push ไป `main` → GitHub Actions deploy Hosting + Firestore rules
