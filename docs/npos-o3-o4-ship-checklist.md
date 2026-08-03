# nPos — ship O3 + O4 + แป้น/หน้าต่างเข้างาน

อัปเดต: **ship 1.14.91** · เฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)

## ลำดับทำ (ทีละเฟส)

| ขั้น | งาน | สถานะ |
|------|-----|--------|
| 1 | แป้นเงินย่อ ~30% · หน้าต่างเข้างานขนาดกลาง | ✅ |
| 2 | **O3** `menuVersion` ซิงก์เมนูตอนแอปค้าง | ✅ code · ค้างคนเทส |
| 3 | **O4** เสียงรับ/ทอน + สวิตช์ตั้งค่า + วิเคราะห์ไทย | ✅ code · ค้างคนเทส |

## 1) แป้น + หน้าต่างเข้างาน
- [x] `UiScale.padKeyMinPx` ย่อ ~30% (ยังแตะได้ ≥ ~40dp)
- [x] `OpenShiftFlow` / dialog: `customMedium` (~72% W / ~82% H)
- [x] ชิปโปรไฟล์พนักงานกะทัดรัด — ไม่เต็มจอ

## 2) O3
- [x] bump `meta/pos.menuVersion` ทุกครั้งที่ BO แก้เมนู
- [x] heartbeat ส่ง `menuVersion`
- [x] Sell เปิดค้าง → `reloadMenu(true)` เมื่อ version โต (throttle 30วิ)
- [x] ▦ รีเฟรชเมนูมือ + toast

## 3) O4 + วิเคราะห์เสียงไทยจริง
- [x] ดูตารางใน [npos-payment-voice-checklist.md](./npos-payment-voice-checklist.md)
- [x] สวิตช์ตั้งค่า · ไทยเท่านั้น · ไม่ fallback อังกฤษ

## ตรวจ
```bash
node scripts/test-npos-menu-version-sync.mjs
node scripts/test-npos-payment-voice.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
