# nPos — ซิงก์เมนูตอนแอปเปิดค้าง (`menuVersion`)

อัปเดต: **ship O3 → 1.14.91** · ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-sell-layout-checklist.md](./npos-sell-layout-checklist.md) · [npos-force-update-pulse-checklist.md](./npos-force-update-pulse-checklist.md) (คนละเรื่อง — อันนั้นคือ APK)

## เป้า
แก้เมนู/ราคาหลังร้านแล้ว หน้าขายที่เปิดอยู่ **อัปเดตเอง** โดยไม่ต้องรีสตาร์ทแอป  
วิธี: เวอร์ชันเมนู → โหลด **ทั้งชุด** เมื่อเปลี่ยน

## นอกสcope รอบนี้
- [x] ซิงก์ทีละรายการ (delta / patch) — ไม่ทำ
- [x] โพลเมนูเต็มทุก heartbeat 5 วิ — ไม่ทำ
- [x] บังคับอัปเดต APK (มีระบบแยกแล้ว)

## งาน

### O3.1 แหล่งความจริง version
- [x] `meta/pos.menuVersion` (timestamp `Date.now()`)
- [x] Bump ทุกครั้งที่บันทึกเมนู/หมวด/ออปชันจาก BO (`bumpMenuVersion`)
- [x] ค่าเปรียบเทียบได้ (ตัวเลขโตขึ้น)

### O3.2 ส่งเข้าเครื่อง
- [x] Heartbeat ส่ง `menuVersion`
- [x] `nposMenuSnapshot` / `nposShopSettings` รวม `menuVersion`

### O3.3 Native
- [x] `MenuSyncCoordinator` เก็บ `localMenuVersion`
- [x] เมื่อ server > local → `reloadMenu(true)` ถ้า Sell เปิดอยู่
- [x] Throttle 30 วิ

### O3.4 สำรอง
- [x] เมนู ▦ → «รีเฟรชเมนู»
- [x] Toast เมื่อเมนูเพิ่งอัปเดตจากเซิร์ฟเวอร์

### O3.5 ตรวจ
- [x] Gate wiring
- [ ] คนเทส: เปิดขายค้าง → แก้ราคา BO → รอ heartbeat → ราคาใหม่บนกริด
- [ ] คนเทส: ออฟไลน์ → ไม่ครASH · กลับออนไลน์แล้วตามทัน

## ตรวจ
```bash
node scripts/test-npos-menu-version-sync.mjs
```
