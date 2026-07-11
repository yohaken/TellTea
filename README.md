# TellTea

ระบบจัดการร้านชา — ขาย / เมนู / ยอดวันนี้ / พนักงาน  
เข้าใช้งานผ่านลิงก์เดียว ล็อกอินด้วย Google

## ลิงก์แอป

**https://telltea-shop.web.app**

แชร์ลิงก์นี้ให้พนักงาน แล้วเพิ่มอีเมล Google ของพวกเขาในหน้า **พนักงาน** (เจ้าของเท่านั้น)

## สิทธิ์

| บทบาท | ทำอะไรได้ |
|--------|-----------|
| owner | ขาย, เมนู, ยอดวันนี้, จัดการพนักงาน |
| staff | ขาย, เมนู, ยอดวันนี้ |

เจ้าของ: `yohaken@gmail.com` (bootstrap อัตโนมัติตอนล็อกอินครั้งแรก)

## สแต็ก

- Next.js 15 (static export) + Tailwind
- Firebase Auth (Google)
- Cloud Firestore
- Firebase Hosting site: `telltea-shop` (โปรเจค GCP `mypeer-501909`)

## พัฒนาในเครื่อง

```bash
cp .env.example .env.local   # หรือใช้ค่าจาก Firebase Console
npm install
npm run dev
```

## Deploy

Push ไป `main` จะรัน GitHub Actions → build + deploy Hosting + Firestore rules

Secrets ที่ต้องมีใน repo:

- `FIREBASE_SERVICE_ACCOUNT` — JSON ของ service account ที่มีสิทธิ์ Firebase
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Deploy มือ:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
npm run build
npx firebase deploy --only hosting,firestore --project mypeer-501909
```

## เปิด Google Sign-In (ครั้งแรก)

1. https://console.firebase.google.com/project/mypeer-501909/authentication/providers
2. เปิด **Google** → Enable → Save
3. Authorized domains ต้องมี `telltea-shop.web.app` และ `localhost`
