# TellTea POS — Native shell (Android / Capacitor)

> สถานะ: โครง APK + พื้นฐานรายงานอัปเดตเข้าหลังบ้าน (POS 56) · 2026-07-18

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
| **N0** | Capacitor config + docs + `isPosNativeShell()` | เปิดโปรเจกต์ใน Android Studio บนเครื่องคุณ |
| **N1** | สร้าง `android/` + debug APK โหลดเว็บสด | ติดตั้งแท็บเล็ตร้าน · เปิดขาย 1 ชม. |
| **N1.5** ← ตอนนี้ | ปล่อย APK ผ่านตั้งค่าหลังบ้าน + รายงานสถานะเครื่อง (`meta/posNativeRelease` / `posDevices`) | เจ้าของใส่เลข APK + URL → เห็นสถานะที่ตั้งค่า → เครื่อง POS |
| **N2** | Kiosk / ล็อกเต็มจอ + เปิดอัตโนมัติตอนบูต | รีบูตแท็บเล็ต → เข้า POS เอง |
| **N3** | พิมพ์เงียบ (Bluetooth/USB bridge) | พิมพ์บิลโดยไม่มี dialog Chrome |
| **N4** | จอลูกค้า activity + heartbeat + ปุ่มรีเซ็ตจากจอพนักงาน | ตัดเน็ต/พังจอลูกค้า → พนักงานกดรีเซ็ตได้ |
| **N5** | ดาวน์โหลด/ติดตั้ง APK ในแอป + (ออปชัน) ฝัง static / Play internal | อัปเดตโดยไม่ต้องส่งไฟล์มือ |

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

## อัปเดต APK ผ่านหลังบ้าน (N1.5)

1. เจ้าของเปิด **ตั้งค่า → เครื่อง POS**
2. กรอก **เลข APK ล่าสุด** + **ลิงก์ไฟล์ .apk** แล้วบันทึก → เขียน `meta/posNativeRelease`
3. แท็บเล็ตที่เปิดจาก Capacitor รายงาน `shellKind=native`, `nativeShellBuild`, `updateStatus` เข้า `posDevices` ทุก heartbeat / เมื่อ release เปลี่ยน
4. หลังบ้านแสดงโหมด (APK / PWA / เบราว์เซอร์) และสถานะ เช่น «มีเวอร์ชันใหม่»

**ยังไม่ทำใน N1.5:** ดาวน์โหลด/ติดตั้งไฟล์ในแอปอัตโนมัติ (รอ native bridge ใน N5)

เลขเปลือกในโค้ด: `POS_NATIVE_SHELL_BUILD` ใน `src/lib/pos-native-version.ts` (bump เมื่อ ship APK ใหม่)

## สิ่งที่ยังไม่ทำ

- Silent print / customer display activity / kiosk boot
- Intent ติดตั้ง APK จากในแอป
- อย่าคาดหวังว่า WebView + Hosting สดจะแก้การค้างรีโหลดระยะยาว — ทางนั้นคือควบคุมอัปเดตเปลือก + (ทีหลัง) ฝัง static

## คู่มือลง APK บนแท็บเล็ตจริง

ดู `docs/pos-native-install.md` — **ข้าม emulator** ใช้แท็บเล็ตจริง (USB Run หรือส่ง APK)

## ความสัมพันธ์กับเว็บ

| ชั้น | เจ้าของ |
|------|---------|
| เมนู ขาย จ่าย ซิงก์ ใบเสร็จ UI | Next.js บน `telltea-pos` |
| Fullscreen, พิมพ์เงียบ, จอลูกค้า revive, boot | Capacitor Android |
| อัปเดตรหัสธุรกิจช่วงพัฒนา | Firebase Hosting + hard reload (POS 54+) |
| ปล่อย/ติดตามอัปเดต APK | ตั้งค่าหลังบ้าน + `meta/posNativeRelease` (POS 56+) |
