# nPos — ตรวจเวอร์ชันขึ้นโปรดักชัน / พร้อมโหลด

อัปเดต: **1.14.60** · ใช้ทุกครั้งหลัง bump `versionCode` / `versionName` / `APP_BUILD` / `POS_BUILD`

## ทำไมต้องเช็ค
โค้ดบน `main` ≠ APK ที่แท็บเล็ตดาวน์โหลดได้เสมอ — ต้องยืนยันว่า **Hosting deploy แล้ว** และ **`latest.json` + APK** ตรงเวอร์ชันที่เพิ่ง ship

## Checklist หลัง ship (ทุกครั้ง)

1. **โค้ด**
   - [ ] `npos-telltea/app/build.gradle` → `versionCode` / `versionName` ตามที่ตั้งใจ
   - [ ] `src/lib/version.ts` (`APP_BUILD`) · `src/lib/pos-version.ts` (`POS_BUILD`) bump แล้ว
   - [ ] merge/push `main` แล้ว (GitHub Actions รัน)

2. **CI / deploy**
   - [ ] Actions สีเขียว (build + Firebase Hosting POS)
   - [ ] ถ้ามี job publish APK — ผ่านครบ

3. **โปรดักชันพร้อมโหลด (live)**
   ```bash
   node scripts/smoke-pos-install-live.mjs
   ```
   สคริปต์นี้ตรวจ:
   - [ ] `https://telltea-pos.web.app/install/` ขึ้นได้
   - [ ] `https://telltea-pos.web.app/downloads/nPos-telltea.apk` ดาวน์โหลดได้ (เป็นไฟล์ APK จริง)
   - [ ] `https://telltea-pos.web.app/downloads/latest.json` มี `versionCode` **≥** ค่าใน `build.gradle`

4. **มือถือ / แท็บเล็ต**
   - [ ] เปิดหน้า install เห็นเวอร์ชันใหม่ก่อนกดโหลด
   - [ ] แอปบนเครื่องบังคับอัปเดต / ติดตั้งได้ถึง `versionCode` ล่าสุด

## อย่าทำ
- อย่าถือว่า push `main` = แท็บเล็ตได้ของใหม่แล้ว โดยไม่รัน smoke live
- อย่า bump เวอร์ชันในโค้ดอย่างเดียวแล้วข้าม `latest.json` / APK

## URL อ้างอิง
| รายการ | URL |
|--------|-----|
| Install | https://telltea-pos.web.app/install/ |
| APK | https://telltea-pos.web.app/downloads/nPos-telltea.apk |
| Manifest | https://telltea-pos.web.app/downloads/latest.json |
| POS app | https://telltea-pos.web.app |
