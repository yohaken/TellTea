# เช็คลิสเทส: P3 UX · P4 ช่องทางขาย · P5 ตัด `/pos/menu/`

> อัปเดต 2026-07-22 · รอบต่อจาก `boh-menu-management-checklist.md`

## สถานะเฟส

| เฟส | งาน | สถานะ |
|-----|-----|--------|
| P3 | ค้นหา/กรอง · สำเนา · เก็บเข้าคลัง | ✅ |
| P4 | ช่องทางหน้าร้าน/เดลิเวอรี่บนหน้าขาย | ✅ |
| P5 | ตัดหน้าจัดการ `/pos/menu/` | ✅ |

---

## P3 — UX หลังร้าน (`/menu/`)

### สคริปต์ (อัตโนมัติ)
- [x] `node scripts/test-boh-menu-p3-p5.mjs` — มีค้นหา · สำเนา · archive · ไม่มี PosMenuAdmin บน `/pos/menu/`
- [x] `npm run test:boh-menu-mgmt` — ยังผ่านหลัง refactor
- [x] `npm run test:pos-menu-cart` — cart + channel price

### ด้วยมือ (หลังร้าน telltea-shop)
- [ ] เปิด อื่นๆ → เมนู
- [ ] พิมพ์ค้นหาชื่อเมนู → เหลือรายการที่ตรง
- [ ] กรองตามหมวด → เห็นเฉพาะหมวดนั้น
- [ ] สลับตัวกรอง ใช้งาน / เก็บแล้ว
- [ ] กด **สำเนา** เมนู → ได้ชื่อ `(สำเนา)` · ราคา/ตัวเลือกตามต้นฉบับ
- [ ] กด **สำเนา** กลุ่มตัวเลือก → ได้กลุ่มใหม่ + ตัวเลือกครบ
- [ ] กดเก็บเข้าคลัง → หายจากหน้าขาย POS · ยังเห็นในตัวกรอง «เก็บแล้ว»
- [ ] จากรายการเก็บแล้ว กด **ลบถาวร** → หายจาก Firestore

---

## P4 — ช่องทางราคาบนหน้าขาย

### สคริปต์
- [x] `resolveMenuItemPrice` / `resolveOptionPriceDelta` ถูกเรียกจาก sell path
- [x] `selectionsFromCounts(..., channel)` ใส่ `priceDelta` ตามช่องทาง
- [x] สลับช่องทางแล้วราคาในกริด/ตะกร้าเปลี่ยน (assert ใน test script)
- [x] nPos: `priceForChannel` / `itemPrice` / `optionDelta` เมื่อเลือกเดลิเวอรี่

### ด้วยมือ (POS Web `/pos/sell/`)
- [ ] มีสวิตช์ **หน้าร้าน / ส่ง** ที่แถบสถานะ
- [ ] เมนูที่มี `deliveryPrice` แสดงราคาเดลิเวอรี่เมื่อเลือก ส่ง
- [ ] ตัวเลือกที่มี `deliveryPriceDelta` คิดเงินตามช่องทาง
- [ ] สลับช่องทางกลางบิล → บรรทัดในตะกร้าปรับราคา
- [ ] จบขายแล้วใบเสร็จเก็บราคา snapshot ตามช่องทางตอนขาย
- [ ] ช่องทางเริ่มต้น = หน้าร้าน

### ด้วยมือ (nPos 1.14.23+)
- [ ] ปุ่มสลับช่องทางใต้หัวตะกร้า
- [ ] ราคาเมนู/ตัวเลือกตามช่องทาง · สลับแล้วตะกร้าปรับราคา

---

## P5 — ตัด `/pos/menu/`

### สคริปต์
- [x] `/pos/menu/page.tsx` ไม่ mount `PosMenuAdmin`
- [x] หน้า stub มีลิงก์หลังร้าน + `/pos/sell/`
- [x] `test-pos-menu-e2e` คาด stub ไม่ใช่ CRUD
- [x] `smoke-pos-hosting` ยังมี `out-pos/pos/menu/index.html` (หน้า stub)
- [x] แถบเคาน์เตอร์ยังไม่มีลิงก์เมนูแอดมิน

### ด้วยมือ
- [ ] เปิด `telltea-pos.web.app/pos/menu/` → เห็นข้อความย้ายไปหลังร้าน · ไม่มีฟอร์ม CRUD
- [ ] กดลิงก์ไป `telltea-shop.web.app/menu/` ได้
- [ ] กดกลับหน้าขายได้
- [ ] `/pos/sell/` ทำงานปกติ

---

## ก่อน merge / deploy

- [x] `APP_BUILD` 256 · `POS_BUILD` 75 · nPos `1.14.23` (46)
- [x] `npm run test:boh-menu-mgmt`
- [x] `npm run test:boh-menu-p3-p5`
- [x] `npm run test:pos-menu-cart`
- [x] อัปเดต `docs/boh-menu-management-checklist.md` ให้ตรงสถานะ
