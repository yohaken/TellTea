# nPos-telltea

แอป Android ทดสอบ / พัฒนาต่อ — เปิดแล้วแสดงข้อความ **Hello World** พร้อมโครงอัปเดตในแอป

## ลิงก์ดาวน์โหลด

| | URL |
|---|---|
| หน้าติดตั้ง | https://telltea-pos.web.app/install/ |
| ไฟล์ APK | https://telltea-pos.web.app/downloads/nPos-telltea.apk |
| แมนิเฟสต์อัปเดต | https://telltea-pos.web.app/downloads/latest.json |

ลิงก์เดียวกันแสดงในหลังร้าน (ตั้งค่าเครื่อง POS)

## เวอร์ชันในแอป

- แสดงชัดบนหน้าจอ: `เวอร์ชัน X.Y.Z (N)` โดย `N` = `versionCode`
- เปิดแอป / กลับมาโฟกัส → เช็ค `latest.json` เอง (อย่างน้อยทุก 60 วินาที)
- ปุ่ม **เช็คอัปเดต** → เช็คเองได้ทุกเมื่อ
- ถ้ามีใหม่ → แบนเนอร์ + ปุ่มเปลี่ยนเป็น **อัปเดตเลย** → ดาวน์โหลด APK → `PackageInstaller`
- ปุ่ม **ตรวจจอ / ฮาร์ดแวร์** → รายการจอ 1, 2, … + สแกน USB/Bluetooth/เครือข่าย

## ตรวจจอ / ฮาร์ดแวร์ (ตั้งแต่ 1.2.0)

- นับจอจาก `DisplayManager` แล้วติดเลข 1, 2, …
- กด “แสดงเลขบนจอ N” เพื่อส่งภาพทดสอบไปจอนั้น (`Presentation`)
- สแกน USB ที่เสียบอยู่, Bluetooth ที่ paired, Wi‑Fi/IP ของเครื่อง
- รอบนี้ยังไม่สั่งพิมพ์/เปิดลิ้นชัก — แค่ตรวจและระบุ

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
