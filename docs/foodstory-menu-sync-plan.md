# แผนซิงก์เมนู: FoodStory → POS Web → POS Native

> ร่างความเข้าใจ · 2026-07-22 · ยังไม่ลงมือ implement จนกว่าจะยืนยันจุดเปิดด้านล่าง

## เป้าหมาย

ให้เมนูจาก [FoodStory manage](https://manage.foodstory.co/th/menu) เชื่อมกับ TellTea POS โดยข้อมูลไม่แตกสองทาง และเครื่องขาย (nPos) ได้เมนูตรงกับหลังร้าน

```
FoodStory (แหล่งต้นทางช่วงแรก)
        │  ดึง / นำเข้า
        ▼
 POS Web  (ตัวกลาง · Firestore menu*)
        │  snapshot / poll (มีอยู่แล้ว)
        ▼
 POS Native (nPos)  ← ช่วงนี้รับอย่างเดียว
```

---

## ความเข้าใจที่ตกลงไว้ (ปรับได้)

| ข้อ | ความหมาย |
|-----|----------|
| **1. ทิศทางข้อมูลช่วงแรก** | FoodStory → POS Web → POS Native ทางเดียว |
| **2. POS Native = ปลายทางแข็ง** | รับ snapshot เมนูไปขาย/แคชเท่านั้น · ยังไม่เป็นแหล่งแก้เมนูหลัก · ไม่ sync ย้อนกลับไป FoodStory |
| **3. POS Web = ยืดหยุ่น** | sync กับ FoodStory ได้ · และเพิ่ม/แก้เมนูมือบน `/pos/menu/` ได้เมื่อลงตัว |
| **4. ลำดับลงมือ** | (A) ดึงเข้า POS Web ให้ครบก่อน → (B) ให้ Native โพลจาก Web ตามเดิม → (C) ค่อยทำให้ Web เป็นต้นทางหลักเมื่อเลิกพึ่ง FoodStory |
| **5. ภาพใหญ่เมื่อลงตัว** | POS Web เป็นตัวกลาง (source of truth ของ TellTea) · FoodStory เป็นแหล่งนำเข้า/อ้างอิงช่วงเปลี่ยนผ่าน · Native อ่านจาก Web อย่างเดียว |

### สิ่งที่มีในระบบอยู่แล้ว (ไม่ต้องสร้างใหม่)

| ชั้น | สถานะ | รายละเอียด |
|------|--------|------------|
| โมเดลเมนู POS Web | ✅ | Firestore `menuCategories` · `menuItems` · `menuOptionGroups` |
| จัดการมือบน Web | ✅ | `/pos/menu/` (เพิ่ม/แก้/เรียง/รูป/ของหมด) |
| Web → Native | ✅ | CF `nposMenuSnapshot` + nPos `MenuRepository` โพล/แคช local-first |
| นำเข้าครั้งเดียว (ออฟไลน์) | ✅ บางส่วน | Wongnai CSV → `seed:pos-menu-catalog` · รูป FoodStory export → `seed:pos-menu-images` |
| FoodStory → Web อัตโนมัติ | ❌ | ยังไม่มี sync ต่อเนื่องจาก `manage.foodstory.co` |

ดังนั้นงานหลักที่ยังขาดคือ **ท่อ FoodStory → POS Web** ไม่ใช่ท่อ Web → Native

---

## เฟสงานที่เสนอ

### Phase 0 — ยืนยันแหล่งข้อมูล FoodStory

ก่อนเขียน sync ต้องรู้ว่าดึงเมนูจาก FoodStory ได้ทางไหน

| ทางเลือก | ข้อดี | ข้อเสีย |
|----------|--------|---------|
| **A. API / webhook ของ FoodStory** | sync ต่อเนื่องได้ | ต้องมี credential + เอกสาร API |
| **B. Export แล้ว import (CSV/JSON/รูป) ตามรอบ** | ทำได้ทันทีด้วยสคริปต์เดิม | คนต้อง export · ไม่ realtime |
| **C. Scrape หน้า manage (ไม่แนะนำ)** | — | เปราะ · ผิด ToS ได้ · ไม่ควรใช้ |

**สมมติฐานชั่วคราว:** ใช้ **B** เป็นรอบแรก (ขยายจาก seed ที่มี) แล้วค่อยอัปเกรดเป็น A ถ้ามี API

### Phase 1 — ดึงเข้า POS Web (หัวใจช่วงแรก)

1. นิยาม **mapping** FoodStory item → `menuItems` / หมวด / กลุ่มตัวเลือก
2. เก็บ `externalSource` + `externalId` (เช่น `foodstory:<id>`) บน doc เพื่อ sync ซ้ำไม่สร้างรายการซ้ำ
3. กฎ conflict:
   - รายการที่มาจาก FoodStory → อัปเดตชื่อ/ราคา/หมวดจากต้นทางได้
   - รายการที่สร้างมือบน POS Web (`source: manual`) → **ไม่ทับ** จาก FoodStory
   - ฟิลด์ POS-only (recommended, visibleOnPos, รูปที่อัปโหลดเอง) → คงค่าเดิมถ้า sync ไม่มีค่าใหม่
4. UI/สคริปต์: ปุ่มหรือคำสั่ง “ซิงก์จาก FoodStory” บนหลังร้าน + บันทึก `lastSyncedAt` / log
5. รูป: ต่อจาก `seed-pos-menu-images` — match ชื่อ/id แล้วเขียน `imageUrl`

**ผลลัพธ์ Phase 1:** เมนูบน `/pos/menu/` และหน้าขายเว็บตรงกับ FoodStory (บวกรายการมือที่เพิ่มเอง)

### Phase 2 — โพลไป POS Native (รับอย่างเดียว)

ไม่เปลี่ยนสถาปัตยกรรมหลัก — ใช้ของเดิม:

```
Firestore menu*  →  nposMenuSnapshot  →  nPos MenuRepository (cache + refresh)
```

งานเสริมถ้าต้องการ:

- แสดงสถานะ “เมนูอัปเดตเมื่อ …” บน native (มี ops log อยู่แล้วบางส่วน)
- บังคับ refresh หลัง sync จาก FoodStory (optional: bump `menuVersion` ใน `meta/pos`)

**Native ไม่เขียนเมนูกลับ** ในเฟสนี้ (ของหมดผ่าน `nposToggleSoldOut` ยังอนุญาตได้ตามที่มี — เป็นสถานะขาย ไม่ใช่ master menu)

### Phase 3 — POS Web เป็นตัวกลางเต็มตัว

เมื่อเลิกพึ่ง FoodStory เป็นต้นทางรายวัน:

- เพิ่ม/แก้เมนูมือบน POS Web เป็นทางหลัก
- FoodStory sync กลายเป็น “นำเข้าครั้งคราว / สำรอง” หรือปิด
- Native ยังรับอย่างเดียวจาก Web
- (ภายหลัง) ถ้าต้องการ sync ไปช่องทางอื่น ค่อยแตก adapter จาก Web ออกไป

---

## กฎความเป็นเจ้าของข้อมูล (ownership)

| ฟิลด์ / การกระทำ | เจ้าของช่วง Phase 1–2 | เจ้าของ Phase 3 |
|------------------|------------------------|-----------------|
| ชื่อ · ราคา · หมวด · ตัวเลือก (จาก FS) | FoodStory | POS Web |
| รายการสร้างมือบน Web | POS Web | POS Web |
| รูป (อัปโหลด POS) | POS Web | POS Web |
| recommended / visibleOnPos | POS Web | POS Web |
| ของหมด (active) หน้าร้าน | POS Web / Native ชั่วคราว | เหมือนเดิม |
| แก้เมนูบน Native | **ห้าม** (ยกเว้นของหมด) | **ห้าม** จนกว่าจะออกแบบแยก |

---

## นอกขอบเขตรอบนี้

- ไม่ scrape `manage.foodstory.co`
- ไม่ให้ Native เป็นต้นทางเมนู
- ไม่ sync ย้อน FoodStory ← POS
- ไม่ตัด FoodStory ออกจากร้านจนกว่า Phase 1 นิ่งและเจ้าของโอเค

---

## คำถามที่ต้องยืนยันก่อนลงมือ

1. **ช่องทางดึง FoodStory** — มี API / export อะไรใช้ได้จริงตอนนี้? (CSV แบบ Wongnai, export ใน FoodStory, หรืออย่างอื่น)
2. **ความถี่** — sync มือเมื่อกด / ตามเวลา (เช่น ทุกคืน) / ใกล้ realtime?
3. **รายการที่หายจาก FoodStory** — ปิดขาย (`active:false`) หรือลบออกจาก POS?
4. **ราคา/ชื่อที่แก้บน POS แล้ว** — รอบ sync ถัดไปทับจาก FoodStory หรือล็อกไว้?
5. **หลายสาขา** — TellTea ใช้เมนูชุดเดียวทั้งร้าน หรือต้อง map ต่อ branch FoodStory?
6. **ตัวเลือก/ท็อปปิ้ง** — ต้อง sync ครบเหมือน FoodStory หรือ Phase 1 เอาแค่ชื่อ+ราคา+หมวดก่อน?
7. **รูป** — ดึงจาก FoodStory ทุกครั้ง หรือใช้ชุด export ที่มี + อัปโหลดมือบน Web เป็นหลัก?

---

## ลำดับไฟล์ที่คาดว่าจะแตะเมื่อ implement (ยังไม่ทำ)

| พื้นที่ | ไฟล์โดยประมาณ |
|---------|----------------|
| แผน/เอกสาร | `docs/foodstory-menu-sync-plan.md` (ไฟล์นี้) |
| Import / sync | `scripts/seed-pos-menu-*.mjs`, `scripts/lib/*`, อาจมี CF `syncFoodstoryMenu` |
| โมเดล | `src/lib/pos-menu.ts`, types — เพิ่ม `externalId` / `source` |
| Admin UI | `PosMenuAdmin` — สถานะ sync / ปุ่มนำเข้า |
| Native | แทบไม่แตะ (รับ snapshot ตามเดิม) ยกเว้นแสดง `fetchedAt` |

---

## สรุปหนึ่งประโยค

**ช่วงนี้ทำท่อ FoodStory → POS Web ให้แน่น; Native แค่รับจาก Web ตามที่มี; พอลงตัว Web เป็นต้นทางและเพิ่มเมนูมือได้เองโดยไม่พึ่ง FoodStory รายวัน**
