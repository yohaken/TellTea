# TellTea

บัญชีร้าน — แทน Google Sheet  
เจ้าของโอนเงินเข้า · พนักงานบันทึกเงินออก · ดูยอดคงเหลือ

## ลิงก์แอป

**https://telltea-shop.web.app**

## บทบาท

| บทบาท | ทำอะไรได้ |
|--------|-----------|
| owner | โอนเข้า, บันทึกเงินออก, ดูรายการ, ลบรายการ, จัดการพนักงาน |
| staff | บันทึกเงินออก, ดูรายการ + ยอดคงเหลือ |

เจ้าของ: `yohaken@gmail.com`

## ข้อมูลเก็บที่ไหน

Cloud Firestore collection `ledger`  
ฟิลด์: วันที่, รายการ, เข้า, ออก, หมวด (type), ผู้บันทึก

## พัฒนาในเครื่อง

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Deploy

Push ไป `main` → GitHub Actions deploy Hosting + Firestore rules
