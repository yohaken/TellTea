# POS versioning (แยกจาก TellTea หลังร้าน)

## กฎ

- **แชต/งาน POS** — เปลี่ยนเฉพาะโค้ด POS, hosting `telltea-pos`, Cloud Functions ที่ POS เรียก
- **เลขเวอร์ชันแยก** — หลังร้านใช้ `APP_BUILD` (`v137` …) · แท็บเล็ต POS ใช้ `POS_BUILD` (`POS 2` …)
- **ห้ามปน** — bump `POS_BUILD` เมื่อ ship POS; bump `APP_BUILD` เมื่อ ship หลังร้าน

## ไฟล์

| ไฟล์ | บทบาท |
|------|--------|
| `src/lib/pos-version.ts` | `POS_BUILD`, `posVersionLabel()` |
| `src/lib/pos-app-update.ts` | poll `/pos-version.json` |
| `scripts/write-version-json.mjs` | เขียน `pos-version.json` ตอน build |
| `src/components/PosUpdateWatcher.tsx` | auto-update จาก `POS_BUILD` |

## Deploy

- หลังร้าน: `telltea-shop.web.app` — `/version.json`
- POS: `telltea-pos.web.app/pos/` — `/pos-version.json`
- จัดการเมนู POS: `telltea-pos.web.app/pos/menu/`

## เมนู POS (POS 3+)

- `menuCategories`, `menuItems`, `menuOptionGroups`
- หน้า `/pos/menu/` — หมวดหมู่ · กลุ่มตัวเลือก · แก้ไขเมนู
- ตอนขาย — popup เลือกตัวเลือก · บันทึกใน `posSales.lines[].options`
- **POS 4** — อัปโหลดรูปเมนู (Firebase Storage `pos-menu/`) · ลากเรียงลำดับ · ราคาหน้าร้านช่องทางเดียว

## บันทึกขาย (local-first)

กดยืนยันขาย → แสดงผลทันทีจาก memory (`stagePendingSale`) → เขียน IndexedDB + sync Cloud Function เบื้องหลัง
