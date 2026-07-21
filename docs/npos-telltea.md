# nPos-telltea

แอป Android ทดสอบง่ายๆ — เปิดแล้วแสดงข้อความ **Hello World**

## ลิงก์ดาวน์โหลด

| | URL |
|---|---|
| หน้าติดตั้ง | https://telltea-pos.web.app/install/ |
| ไฟล์ APK | https://telltea-pos.web.app/downloads/nPos-telltea.apk |

ลิงก์เดียวกันแสดงในหลังร้าน (ตั้งค่าเครื่อง POS)

## สร้าง APK เอง

```bash
cd npos-telltea
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

แล้วคัดลอกเข้า hosting export:

```bash
node scripts/publish-pos-apk.mjs
```

## รายละเอียดแอป

- ชื่อบนเครื่อง: `nPos-telltea`
- package: `app.telltea.npos`
- ไม่เกี่ยว Capacitor / เว็บ POS เดิม
