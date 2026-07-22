# nPos-telltea

แอป Android หน้าร้าน TellTea — เข้างาน · ขาย · ชำระ · พิมพ์ · อัปเดตในแอป

## ลิงก์ดาวน์โหลด (ส่งพนักงาน)

| | URL |
|---|---|
| หน้าติดตั้ง + QR | https://telltea-pos.web.app/install/ |
| ไฟล์ APK | https://telltea-pos.web.app/downloads/nPos-telltea.apk |
| แมนิเฟสต์อัปเดต | https://telltea-pos.web.app/downloads/latest.json |
| QR ภาพ | https://telltea-pos.web.app/install/qr-pos-install.png |

ลิงก์/QR เดียวกันอยู่ในหลังร้าน → ตั้งค่าเครื่อง POS

## เวอร์ชันในแอป

- แสดงชัดบนหน้าจอ: `เวอร์ชัน X.Y.Z (N)` โดย `N` = `versionCode`
- หน้าแรก: brand + รหัสเครื่อง + heartbeat — เครื่องมืออยู่ใน **ตั้งค่า**
- ในตั้งค่า: เช็คอัปเดต / ลิงก์ติดตั้ง / ตรวจจอ·ฮาร์ดแวร์ / เทสจอลูกค้า (N3)
- เปิดตั้งค่า → เช็ค `latest.json` เอง (อย่างน้อยทุก 60 วินาที)
- ปุ่ม **เช็คอัปเดต** → เช็คเองได้ทุกเมื่อ
- ถ้ามีใหม่ → แบนเนอร์ + ปุ่มเปลี่ยนเป็น **อัปเดตเลย** → ดาวน์โหลด APK → `PackageInstaller`

## ตรวจจอ / ฮาร์ดแวร์ (ตั้งแต่ 1.2.0 / รายงานหลังร้าน 1.3.0)

- นับจอจาก `DisplayManager` แล้วติดเลข 1, 2, …
- กด “แสดงเลขบนจอ N” เพื่อส่งภาพทดสอบไปจอนั้น (`Presentation`)
- สแกน USB ที่เสียบอยู่, Bluetooth ที่ paired, Wi‑Fi/IP ของเครื่อง
- กด **ส่งผลกลับหลังร้าน** → Cloud Function `reportNposDiagnose` → หมวดพับใน POS จัดการ
- เปิดแอปแล้วส่ง heartbeat → `posDevices` (รหัสเครื่อง + ออนไลน์ในหลังร้าน)
- `installId` ยึด `ANDROID_ID` + `stableKey` เพื่อไม่ให้ wipe/reinstall สร้างเครื่องซ้ำในหลังร้าน
- เฟสย้ายเว็บ→native: [npos-migration-phases.md](./npos-migration-phases.md)

## จอลูกค้า (N3 / 1.5.0)

- ตั้งค่า → ส่งยอดทดสอบ ฿120 / ฿350 ไปจอเพิ่ม (จอ 2) ด้วย `Presentation`
- ถ้ายังมีจอเดียว จะโชว์บนจอหลักชั่วคราวเพื่อเทส layout

## ปริ้นเตอร์ / ลิ้นชัก (N4–N5 / 1.6.0)

- ตั้งค่า → สแกน USB (bulk OUT) หรือ Bluetooth ที่ paired → พิมพ์หน้าทดสอบ ESC/POS
- ปุ่ม **เปิดลิ้นชัก** ส่ง `ESC p` ผ่านปริ้นเตอร์เดียวกัน
- สำเร็จแล้ว heartbeat ส่ง `printerReady` / `printerLabel` กลับ `posDevices`

## Ops log ไทม์ไลน์

- error / ผลฮาร์ดแวร์สั้นๆ → Cloud Function `reportNposOpsLog` → `nposOpsLog/{installId}`
- หลังร้าน: **จัดการ Pos → ไทม์ไลน์ nPos** (อ่านเพื่อแก้ APK รอบถัดไป โดยไม่ต้องถามศัพท์เทคนิคจากร้าน)

## สร้าง / ปล่อยเวอร์ชันใหม่

1. บัมพ์ใน `npos-telltea/app/build.gradle`:
   - `versionCode` (ต้องเพิ่มทุกครั้งที่อยากให้อัปเดต)
   - `versionName` (เช่น `1.2.0`)
2. บิลด์ + publish:

```bash
cd npos-telltea && ./gradlew assembleDebug
cd .. && node scripts/publish-pos-apk.mjs
```

3. Deploy hosting (CI ทำให้อัตโนมัติตอน push `main`)
4. แนะนำให้ตั้งเลข APK ในหลังร้านให้ตรง `versionCode` ด้วย

`latest.json` ที่ publish จะมีอย่างน้อย:

```json
{
  "product": "nPos-telltea",
  "versionCode": 2,
  "versionName": "1.1.0",
  "apkUrl": "https://telltea-pos.web.app/downloads/nPos-telltea.apk",
  "notes": "..."
}
```

## รายละเอียดแอป

- ชื่อบนเครื่อง: `nPos-telltea`
- package: `app.telltea.npos`
- อัปเดตทับได้เฉพาะ APK ที่เซ็นด้วยคีย์เดิม
- ผู้ใช้ยังต้องกดยืนยันติดตั้งบน Android ทั่วไป (ไม่ใช่โหมด Device Owner)
- APK เซ็นด้วยคีย์คงที่ใน `npos-telltea/keystore/` เพื่อให้อัปเดตทับกันได้ข้ามรอบ CI
- ถ้าเครื่องเดิมลงด้วยคีย์เก่า (ก่อน 1.2.1) ต้อง**ถอนติดตั้งครั้งหนึ่ง** แล้วลงใหม่จากหน้าติดตั้ง — รอบถัดไปอัปเดตทับได้
