# เช็คลิส: ระบบจัดการเมนูหลังร้าน

> อ้างอิงแผน: `docs/boh-menu-management-phases.md`  
> อัปเดต 2026-07-22

## สถานะรวม

| เฟส | สถานะ |
|-----|--------|
| P0 แผน | ✅ |
| P1 โครง อื่นๆ + `/menu/` | ✅ |
| P2 CRUD parity | ✅ |
| P3 UX ขั้นสูง | ✅ |
| P4 ราคา 2 ช่องทาง + ช่องทางขาย | ✅ |
| P5 Cutover `/pos/menu/` | ✅ stub |
| P6 นำเข้า CSV / ภายนอก | ❌ **ตัดออก** — ไม่ทำ |
| Q1–Q4 UX รอบถัดไป | ดู `docs/boh-menu-next-phases.md` |

เช็คลิสเทสรอบ P3–P5: `docs/boh-menu-p3-p5-test-checklist.md`

---

## P0 — ตกลงขอบเขต

- [x] แหล่งหลัก = หลังร้าน อื่นๆ → เมนู
- [x] คง `/pos/sell/` (หน้าขาย)
- [x] Cutover เป้าหมาย = `/pos/menu/` (จัดการบน POS)
- [x] ราคา 2 ช่องทางอยู่ในแผน
- [x] เอกสารเฟส + เช็คลิส

---

## P1 — โครงหลังร้าน

- [x] การ์ด **เมนู** ใน `/more/` (owner)
- [x] Route `/menu/` บน telltea-shop
- [x] `AppShell` MORE_PREFIXES รวม `/menu`
- [x] Owner gate (redirect ถ้าไม่ใช่เจ้าของ)
- [x] อ่านแคตตาล็อกจาก Firestore ด้วย Google owner auth (`getDb` via `setMenuDbMode("owner")`)
- [x] Bump `APP_BUILD` → 255

---

## P2 — CRUD parity

- [x] `setMenuDbMode("owner"|"pos")` ใน `pos-menu-db.ts`
- [x] `PosMenuAdmin` รองรับ `authMode="owner"` — ไม่เรียก `ensurePosDeviceAuth`
- [x] สร้าง/แก้/ลบ หมวด · เมนู · กลุ่มตัวเลือก (reuse editors)
- [x] รูป · ผูกกลุ่ม · เรียงลำดับ
- [x] เขียนแล้วขึ้นบน `/pos/sell/` + nPos snapshot อัตโนมัติ (collection เดิม)
- [x] สคริปต์ `scripts/test-boh-menu-mgmt.mjs`

---

## P3 — UX ขั้นสูง (รอบถัดไป)

- [x] Duplicate เมนู / กลุ่ม
- [x] ค้นหา · กรองตามหมวด
- [x] Soft-delete / archive (+ กู้คืน / ลบถาวร)
- [ ] คำอธิบายช่วยเหลือสั้นๆ (ยังไม่ทำ)

---

## P4 — ราคา 2 ช่องทาง

- [x] `MenuItem.deliveryPrice?`
- [x] `MenuOptionChoice.deliveryPriceDelta?`
- [x] map/serialize + patch ใน lib + `resolveMenuItemPrice` / `resolveOptionPriceDelta`
- [x] UI ฟอร์มเมนู: ราคาหน้าร้าน + เดลิเวอรี่
- [x] UI ตัวเลือก: ราคาเพิ่มหน้าร้าน + เดลิเวอรี่
- [x] `nposMenuSnapshot` ส่งฟิลด์ใหม่
- [x] nPos `MenuModels` รับฟิลด์ + `priceForChannel`
- [x] fallback: ไม่มีฟิลด์เดลิเวอรี่ → ใช้ราคาหน้าร้าน
- [x] sell channel เลือกชุดราคาบน counter (เว็บ + nPos)

---

## P5 — Cutover

- [x] Banner บน `/pos/menu/` (ก่อนตัด)
- [x] ลิงก์ไป `https://telltea-shop.web.app/menu/`
- [x] ตัด CRUD — `/pos/menu/` เป็น stub ย้ายไปหลังร้าน
- [x] อัปเดต `pos-versioning.md` / e2e stub

---

## P6 — นำเข้า (ยกเลิก)

- [x] **ตัดออกจากแผน** — ไม่ทำ CSV / FoodStory UI ในแอป  
- รายละเอียดรอบถัดไป: `docs/boh-menu-next-phases.md` (Q1 ราคาเดลิเวอรี่ชัด · Q2 หมวด · Q3 ผูกเมนู)

---

## ทดสอบก่อน merge

- [x] `node scripts/test-boh-menu-mgmt.mjs`
- [x] `npm run test:pos-menu-cart`
- [x] ไม่เรียก `ensurePosDeviceAuth` บน path BOH
- [x] Static tests ผ่าน (prod/stock catalog bump 255)
