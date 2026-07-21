# TellTea POS — Native shell (Android / Capacitor)

> สถานะ: **APK ฝังหน้าในเครื่อง (ไม่โหลด UI จาก Hosting)** · POS 62 / shell 2 · 2026-07-21

## โมเดลตอนนี้

| ชั้น | พฤติกรรม |
|------|----------|
| ไฟล์ดาวน์โหลด `.apk` | ฝัง `out-pos/pos` ใน APK — **ไม่มี `server.url` ชี้เว็บสด** |
| เปิดไอคอน TellTea POS | รันจากไฟล์ในเครื่อง (WebView + สินทรัพย์ฝัง) |
| Firebase / ซิงก์ | ยังใช้เน็ตเรียก API ตามเดิม |
| เว็บ `telltea-pos.web.app/pos/` | สำรองในเบราว์เซอร์เท่านั้น — **ไม่ใช่แหล่ง UI ของ APK อีกต่อไป** |

> ไม่ใช่การรีไรต์เป็น Kotlin native 100% — แต่เลิกโหมด “แอปหุ้มเว็บสด” ตามที่สั่ง

## เฟสงาน

| Phase | งาน | สถานะ |
|-------|-----|--------|
| **N0–N1** | Capacitor + android/ | ทำแล้ว |
| **N1.5** | รายงานสถานะ / ปล่อยลิงก์ | ทำแล้ว |
| **N1.6** ← ตอนนี้ | **ฝัง static ใน APK (เลิก live Hosting UI)** | ทำใน deploy |
| **N2+** | Kiosk / พิมพ์เงียบ / อัปเดต APK ในแอป | ยัง |

## บิลด์

```bash
npm ci
npm run build
npm run cap:sync:embed   # หรือดีฟอลต์ sync ก็ฝังแล้ว (ไม่ตั้ง CAPACITOR_LIVE)
cd android && ./gradlew assembleDebug
```

โหลดเว็บสดชั่วคราว (เฉพาะตอนพัฒนา):

```bash
CAPACITOR_LIVE=1 npx cap sync android
```

CI ลงไฟล์ที่ `https://telltea-pos.web.app/downloads/telltea-pos.apk` หลัง embed + assemble เท่านั้น
