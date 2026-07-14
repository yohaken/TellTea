# TellTea POS — Native shell (Android / Capacitor)

> สถานะ: เริ่มโครง APK หุ้มเว็บเดิม (ไม่รีไรต์แอป) · 2026-07-14

## ทำไมต้องมี

PWA ใน Chrome ติดข้อจำกัดที่ร้านเจอจริง:

- จอลูกค้าพังแล้วไม่มีใครกด Refresh
- พิมพ์ใบเสร็จยังโดน dialog เบราว์เซอร์
- อัปเดตเว็บตอน deploy ทำให้แท็บค้าง JS เก่า

ทางแก้ระยะกลาง: **APK Capacitor** หุ้ม `https://telltea-pos.web.app/pos/`  
ธุรกิจ (เมนู/ขาย/ซิงก์) ยังเป็นโค้ดเว็บชุดเดิม — ย้ายเฉพาะชั้นระบบปฏิบัติการ

## เฟสงาน

| Phase | งาน | เทสต์ |
|-------|-----|--------|
| **N0** ← ตอนนี้ | Capacitor config + docs + `isPosNativeShell()` | เปิดโปรเจกต์ใน Android Studio บนเครื่องคุณ |
| **N1** | สร้าง `android/` + debug APK โหลดเว็บสด | ติดตั้งแท็บเล็ตร้าน · เปิดขาย 1 ชม. |
| **N2** | Kiosk / ล็อกเต็มจอ + เปิดอัตโนมัติตอนบูต | รีบูตแท็บเล็ต → เข้า POS เอง |
| **N3** | พิมพ์เงียบ (Bluetooth/USB bridge) | พิมพ์บิลโดยไม่มี dialog Chrome |
| **N4** | จอลูกค้า activity + heartbeat + ปุ่มรีเซ็ตจากจอพนักงาน | ตัดเน็ต/พังจอลูกค้า → พนักงานกดรีเซ็ตได้ |
| **N5** | โหมดฝัง static ใน APK (ออปชัน) หรือ Play internal testing | อัปเดตผ่านแพลตฟอร์มควบคุมได้ |

## สร้างโปรเจกต์ Android (เครื่องที่มี Android Studio)

```bash
# จากราก repo
npm ci
npm run build          # สร้าง out-pos/pos
npx cap add android    # ครั้งแรกเท่านั้น
npx cap sync android
npx cap open android   # เปิด Android Studio → Run บนแท็บเล็ต
```

ช่วงพัฒนาดีฟอลต์จะโหลด **เว็บสด** จาก Hosting (`CAPACITOR_POS_URL` หรือ `https://telltea-pos.web.app/pos/`)  
ดังนั้นแก้เว็บ + deploy แล้วแค่ให้ WebView รีโหลด — ไม่ต้องรีบิลด์ APK ทุกครั้ง

ฝังเว็บใน APK (ออฟไลน์มากขึ้น):

```bash
CAPACITOR_EMBED=1 npm run build
CAPACITOR_EMBED=1 npx cap sync android
```

## คุณเทสต์ยังไง (สั้น)

1. **ยังไม่มี APK:** Chrome แท็บเล็ตเปิด `telltea-pos.web.app/pos/` ตามเดิม — เป็น baseline
2. **มี debug APK:** ติดตั้งทับ · เปิดขายจริง · สังเกตว่าหลุด/ค้างน้อยกว่า PWA หรือไม่
3. **สองจอ (หลัง N4):** HDMI / จอพลิก · ดูว่าจอลูกค้าหลุดแล้วปุ่มรีเซ็ตจากจอพนักงานได้
4. **เกณฑ์ผ่านร้าน:** ไม่ต้องเดินไปกดรีเฟรชจอลูกค้า · พิมพ์ไม่ขึ้น dialog · เปิดเครื่องใหม่เข้าแอปเอง

## สิ่งที่ยังไม่ทำใน N0

- โฟลเดอร์ `android/` อยู่ใน repo แล้ว — สร้าง APK ด้วย Android Studio บนเครื่องคุณ
- Silent print / customer display activity
- เปลี่ยน `POS_BUILD` ทุกครั้งที่แก้แค่ docs — เว็บยังเป็นแหล่งฟีเจอร์หลัก

## คู่มือลง APK บนแท็บเล็ตจริง

ดู `docs/pos-native-install.md` — **ข้าม emulator** ใช้แท็บเล็ตจริง (USB Run หรือส่ง APK)

## ความสัมพันธ์กับเว็บ

| ชั้น | เจ้าของ |
|------|---------|
| เมนู ขาย จ่าย ซิงก์ ใบเสร็จ UI | Next.js บน `telltea-pos` |
| Fullscreen, พิมพ์เงียบ, จอลูกค้า revive, boot | Capacitor Android |
| อัปเดตรหัสธุรกิจช่วงพัฒนา | Firebase Hosting + hard reload (POS 54+) |
