# nPos — ซิงก์เมนูตอนแอปเปิดค้าง (`menuVersion`)

อัปเดต: **แผน O3** · ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-sell-layout-checklist.md](./npos-sell-layout-checklist.md) · [foodstory-menu-sync-plan.md](./foodstory-menu-sync-plan.md) · [npos-force-update-pulse-checklist.md](./npos-force-update-pulse-checklist.md) (คนละเรื่อง — อันนั้นคือ APK)

## เป้า
แก้เมนู/ราคาหลังร้านแล้ว หน้าขายที่เปิดอยู่ **อัปเดตเอง** โดยไม่ต้องรีสตาร์ทแอป  
วิธี: เวอร์ชันเมนู → โหลด **ทั้งชุด** เมื่อเปลี่ยน

## นอกสcope รอบนี้
- [ ] ซิงก์ทีละรายการ (delta / patch)
- [ ] โพลเมนูเต็มทุก heartbeat 5 วิ
- [ ] บังคับอัปเดต APK (มีระบบแยกแล้ว)

## สถานะปัจจุบัน
| ข้อ | พฤติกรรม |
|-----|----------|
| เปิด Sell | `loadMenu` ครั้งเดียวตอน `onCreate` |
| Heartbeat | ไม่รีเฟรชเมนู |
| `MenuWarmup` | อัปเดตแคชดิสก์ · ไม่บังคับกริดขาย |
| ปุ่มรีเฟรช | ซ่อน intentionally |
| `menuVersion` บน `meta/pos` | มีทาง FoodStory apply · ยังไม่ขับ native |

## งาน

### O3.1 แหล่งความจริง version
- [ ] กำหนดฟิลด์เดียว (เช่น `meta/pos.menuVersion` หรือ shop field)
- [ ] Bump ทุกครั้งที่บันทึกเมนู/หมวด/ออปชันจาก BO
- [ ] Bump ตอน FoodStory apply (ถ้ายังใช้)
- [ ] ค่าเป็นตัวเลขเพิ่มทีละ 1 หรือ timestamp ที่เปรียบเทียบได้

### O3.2 ส่งเข้าเครื่อง
- [ ] Heartbeat และ/หรือ `nposShopSettings` / `nposMenuSnapshot` ส่ง `menuVersion`
- [ ] ไม่เพิ่ม payload หนักเกินจำเป็น

### O3.3 Native
- [ ] เก็บ `localMenuVersion` คู่กับแคชเมนู
- [ ] เมื่อ server > local → `reloadMenu(true)` แล้วอัปเดตกริดถ้า Sell เปิดอยู่
- [ ] JSON เท่าเดิม → ไม่กระพริบ UI โดยไม่จำเป็น
- [ ] Throttle (เช่น ไม่รีโหลดถี่กว่า 30 วิ)

### O3.4 สำรอง (ทางเลือก)
- [ ] เมนู ▦ → «รีเฟรชเมนู» เรียก `reloadMenu(true)`
- [ ] Toast สั้นเมื่อเมนูเพิ่งอัปเดตจากเซิร์ฟเวอร์

### O3.5 ตรวจ
- [ ] Gate: bump path + native compare + reload wiring
- [ ] คนเทส: เปิดขายค้าง → แก้ราคา BO → รอ heartbeat → ราคาใหม่บนกริด
- [ ] คนเทส: ออฟไลน์ → ไม่ครASH · กลับออนไลน์แล้วตามทัน

## ตรวจ
```bash
node scripts/test-npos-counter-ops-phases.mjs
# หลังลงมือ: node scripts/test-npos-menu-version-sync.mjs
```
