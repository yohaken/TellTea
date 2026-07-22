# nPos — ตัดช่องทางเข้าหลังร้าน / เว็บ BO จากเคาน์เตอร์

อัปเดต: **1.14.18** · `APP_BUILD` 250 · `POS_BUILD` 70 · `versionCode` 41  

## ทิศทางที่ล็อก
| ฝั่ง | ทำ | ไม่ทำ |
|------|-----|--------|
| Native nPos | ขาย · บิลค้าง · ใบเสร็จ · กะ · ตั้งค่าเครื่อง · หน้าติดตั้ง APK | เปิดเบราว์เซอร์เข้าหลังร้าน / เมนูแอดมิน / สต็อก |
| เว็บ `/pos/*` nav | ขาย · บิล · ใบเสร็จ · กะ · ตั้งค่าเครื่อง | inventory · ops · menu ในแถบนำทาง |
| Capacitor allowNavigation | `telltea-pos` + Firebase APIs | `telltea-shop` · `*.web.app` กว้าง |
| ซิงก์ API | Cloud Functions ตามเดิม | เปลี่ยนเป็นนำทาง UI |

---

## ตัดแล้ว (C1–C5)

### C1 เว็บ POS
- [x] เอา **สินค้าคงคลัง** / **ลิงก์จากร้าน** ออกจาก `POS_NAV_ITEMS`
- [x] เอา **เมนูและโปรโมชั่น** ออกจากแถบเคาน์เตอร์
- [x] `PosInventoryView` — stub ไม่มีลิงก์ `mypeer` / `stock`
- [x] `PosOpsNotesView` — อนุญาตเฉพาะ `telltea-pos.web.app` `/install` · `/downloads`
- [x] `PosShiftView` / `PosSellView` — ไม่มีลิงก์ออกหลังบ้าน

### C2 Native hub / shell
- [x] `MainActivity.buildHubNav` — native อย่างเดียว (ไม่มี `addHubWeb`)
- [x] `PosShellNav` — ไม่มีลิงก์เว็บ inventory/menu/ops/shop-settings
- [x] `ShiftActivity` — ไม่มีปุ่มเปิดรอบเว็บ
- [x] `SettingsActivity` — ซ่อนปุ่มเปิด `/pos/menu/`

### C3 เชลล์ / อัปเดต
- [x] `capacitor.config.ts` — ไม่มี `telltea-shop` ใน allowNavigation
- [x] `ApkInstaller.openInstallPage` — allowlist โดเมน POS เท่านั้น

### C4 เอกสาร / เกต
- [x] เช็คลิสต์นี้ + `test-npos-cut-bo-entry.mjs`
- [x] ผูกใน `check-npos-shop.mjs`
- [x] `pos-nav-e2e` / `pos-menu-e2e` ไม่พึ่งลิงก์เมนูในแถบเคาน์เตอร์

### C5 คนเทส (ค้าง)
- [ ] บน nPos ไม่มีปุ่มเปิด Chrome ไป telltea-shop / stock / pos-sales
- [ ] เว็บ `/pos/sell` แถบซ้ายไม่มีเมนู · สต็อก · ลิงก์จากร้าน
- [ ] ตั้งค่า → หน้าติดตั้งเปิดได้เฉพาะ telltea-pos install

---

## ตรวจ
```bash
node scripts/test-npos-cut-bo-entry.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
