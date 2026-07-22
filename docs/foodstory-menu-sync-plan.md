# แผนซิงก์เมนู: FoodStory → POS Web → POS Native

> อัปเดต 2026-07-22 · ยืนยันครบแล้ว (ข้อ 3 = B ลบออกจาก POS)

## เป้าหมาย

ให้เมนูจาก [FoodStory manage](https://manage.foodstory.co/th/menu) เชื่อมกับ TellTea POS โดยข้อมูลไม่แตกสองทาง และเครื่องขาย (nPos) ได้เมนูตรงกับหลังร้าน

```
FoodStory (แหล่งต้นทางช่วงเปลี่ยนผ่าน)
        │  ดึงผ่านเบราว์เซอร์ที่ล็อกอินแล้ว (กดมือ)
        ▼
 POS Web  (ตัวกลาง · Firestore menu*)
        │  snapshot / poll (มีอยู่แล้ว)
        ▼
 POS Native (nPos)  ← ช่วงนี้รับอย่างเดียว
```

---

## การตัดสินใจที่ยืนยันแล้ว

| # | คำถาม | คำตอบ |
|---|--------|--------|
| 1 | ช่องทางดึง FoodStory | **ควบคุมเบราว์เซอร์** ที่ล็อกอิน `manage.foodstory.co` เพื่อดึงข้อมูลหลัก (ช่วงนี้ยังไม่มี API) |
| 2 | ความถี่ | **กดมือ** · แต่เตรียมโครงหลังร้านไว้ครบ: POS → ระบบซิงก์… (ปุ่ม/สถานะ/ประวัติ) |
| 3 | รายการที่หายจาก FoodStory | **B ลบออกจาก POS** (รายการที่เคย map จาก FS แต่รอบนี้ไม่มีใน snapshot) |
| 4 | แก้ชื่อ/ราคาบน POS แล้ว | **sync ไป POS** = ค่าจาก FoodStory ทับฟิลด์ที่มาจาก FS บน POS |
| 5 | ตัวเลือก/ท็อปปิ้ง | **ครบ ใช้งานขายได้จริง** (กลุ่มตัวเลือก · required/min/max · ราคาเพิ่ม) |

### ความเข้าใจที่ตกลงไว้

| ข้อ | ความหมาย |
|-----|----------|
| ทิศทางช่วงแรก | FoodStory → POS Web → POS Native ทางเดียว |
| POS Native | รับ snapshot เท่านั้น · ไม่เป็นต้นทางเมนู |
| POS Web | ยืดหยุ่น · มีปุ่มซิงก์ + เพิ่มเมนูมือได้เมื่อลงตัว |
| Conflict (รายการจาก FS) | รอบซิงก์ถัดไป **ทับชื่อ/ราคา/หมวด/ตัวเลือก** จาก FoodStory → POS |
| รายการหายจาก FS | **ลบ** doc ที่ `source=foodstory` / มี `externalId` แต่ไม่อยู่ใน snapshot รอบนี้ |
| รายการสร้างมือบน POS (`source: manual`) | **ไม่ทับ / ไม่ลบ** จาก FoodStory |
| ขอบเขต sync | หมวด · เมนู · รูป (ถ้าดึงได้) · **กลุ่มตัวเลือกครบ** |

---

## ข้อ 3 — รายการที่หายจาก FoodStory → **B ลบ** (ล็อกแล้ว)

ตัวอย่าง: ซิงก์รอบแรกมีชาเย็น · โกโก้ · ชาไทย → วันรุ่งขึ้น FS ลบโกโก้ → กดซิงก์ → **ลบโกโก้ออกจาก POS**

กฎ:

- ลบเฉพาะรายการที่มาจาก FoodStory (`externalSource: "foodstory"` + มี `externalId`) และ**ไม่อยู่ใน snapshot รอบนี้**
- ไม่ลบรายการ `source: manual`
- หมวด/กลุ่มตัวเลือกที่ไม่มีลูกเหลือและมาจาก FS → ลบหรือเก็บว่างตาม implement (ควรลบหมวดว่างจาก FS ด้วยเพื่อให้ตรง)
- หมายเหตุความเสี่ยง: บิลเก่าเก็บชื่อ/ราคาในตัวบิลอยู่แล้ว · แต่ id เมนูบน POS อาจไม่กลับมาเหมือนเดิมถ้าเอาเมนูกลับใน FS ภายหลัง (สร้างใหม่ตาม `externalId` ได้)

---

## สิ่งที่มีในระบบอยู่แล้ว

| ชั้น | สถานะ | รายละเอียด |
|------|--------|------------|
| โมเดลเมนู POS Web | ✅ | `menuCategories` · `menuItems` · `menuOptionGroups` |
| จัดการมือบน Web | ✅ | `/pos/menu/` |
| Web → Native | ✅ | `nposMenuSnapshot` + nPos โพล/แคช |
| นำเข้าออฟไลน์ครั้งคราว | ✅ บางส่วน | Wongnai CSV · รูป FoodStory export |
| FoodStory → Web ผ่านเบราว์เซอร์ + ปุ่มหลังร้าน | ❌ | งานหลักที่ต้องทำ |

---

## เฟสงาน

**ติดตอนนี้:** Cloud agent **คุม Chrome บนเครื่องคุณไม่ได้** (คนละเครื่อง)  
ทางไปต่อที่คุณไม่ต้องวาง idKey เอง: เปิดงานนี้บน **Cursor agent ในเครื่องคุณ** (local) แล้วสั่งให้เกาะ Chrome ที่เปิดเมนูค้างไว้ด้วย `--attach-chrome`

### Phase 0 — ตัวดึงข้อมูลผ่านเบราว์เซอร์ / เซสชัน ✅ (โครงพร้อม)

สถานะ: **เครื่องมือพร้อม** · รอเซสชันร้านจริงเพื่อรัน capture ครั้งแรก

| ชิ้น | ไฟล์ / คำสั่ง |
|------|----------------|
| Login เก็บ storage | `npm run foodstory:menu-login -- --headed` |
| Capture → snapshot | `npm run foodstory:menu-capture` |
| เทสนormalizer | `npm run test:foodstory-menu-capture` |
| Auth (gitignored) | `scripts/data/foodstory-auth/session.json` |
| ผลลัพธ์ | `scripts/data/foodstory-snapshots/snapshot-latest.json` |

**วิธีที่ได้ผลตอนนี้ (Cloudflare บล็อก headless):**

1. เปิด `https://manage.foodstory.co/th/menu` ในเบราว์เซอร์ที่ล็อกอินแล้ว  
2. DevTools → Console: `copy({ idKey: localStorage.idKey, branchId: localStorage.branch_id })`  
3. วางลง `scripts/data/foodstory-auth/session.json` (ดู `session.example.json`)  
4. `npm run foodstory:menu-capture`

ตัว capture เรียก API ที่ SPA ใช้จริง (`fs-api.foodstory.co/v1/master/branch/{id}/…`) ด้วย header `access-token: idKey`  
ได้หมวด · เมนู · กลุ่มตัวเลือก · ตัวเลือก/ท็อปปิ้ง · ลิงก์เมนู↔ตัวเลือก · รูป (`images.foodstory.co`)  
เขียน **raw + snapshot** อย่างเดียว — **ยังไม่ลง Firestore** (Phase 1)

หมายเหตุ: โหมด Playwright headless ใน cloud มักโดน Cloudflare ที่ `owner.foodstory.co/login` — ใช้เซสชันจากเบราว์เซอร์จริงเป็นหลัก

### Phase 1 — ปุ่มหลังร้าน “ระบบซิงก์” + เขียนเข้า POS Web ✅ รอบแรกเสร็จ

สถานะ: **apply รอบแรกเข้า Firestore แล้ว** (2026-07-22)

| | จำนวน |
|--|--------|
| หมวด | 22 |
| เมนู | 189 |
| กลุ่มตัวเลือก | 20 |

```bash
# ดูแผนก่อน (ไม่เขียน)
npm run foodstory:menu-apply -- --dry-run

# เขียนเข้า Firestore (ทับของ foodstory · ลบที่หาย · ลบ orphan เก่าที่ไม่ใช่ manual)
npm run foodstory:menu-apply -- --apply
```

กฎที่ล็อกแล้ว:

1. map ด้วย `externalSource: "foodstory"` + `externalId`
2. มีแล้ว → อัปเดตชื่อ/ราคา/หมวด/optionGroupIds จาก snapshot
3. ไม่มี → สร้างใหม่
4. `source: manual` → ไม่ยุ่ง
5. รายการที่หายจาก FS → **ลบ** จาก POS (เฉพาะที่มาจาก FS)
6. orphan เก่า (ไม่มี externalId / ไม่ใช่ manual) → ลบด้วย (ใส่ `--keep-orphans` ถ้าอยากเก็บ)
7. ตัวเลือกครบ: สร้าง/อัปเดต `menuOptionGroups` ให้ขายจริงได้
8. คง `recommended` / `visibleOnPos` เดิมตอนอัปเดต

ผลลัพธ์: `/pos/menu/` + หน้าขายเว็บตรง FS (บวกรายการมือ) · Native รับต่อผ่าน `nposMenuSnapshot`  
UI หลังร้าน “POS → ระบบซิงก์” ยังเป็นขั้นถัดไป (ตอนนี้ใช้คำสั่ง / local capture+apply)

### Phase 2 — ไหลไป Native (ของเดิม)

```
Firestore menu*  →  nposMenuSnapshot  →  nPos MenuRepository
```

หลังซิงก์สำเร็จ อาจ bump `menuVersion` / บันทึก `meta` เพื่อให้ native รู้ว่ามีของใหม่ (optional)

### Phase 3 — Web เป็นต้นทาง

เมื่อเลิกพึ่ง FoodStory รายวัน: เพิ่ม/แก้บน POS Web เป็นหลัก · ปุ่มซิงก์ FS เหลือเป็นนำเข้าครั้งคราวหรือปิด

---

## Ownership (ช่วง Phase 1–2)

| ฟิลด์ | เจ้าของ |
|-------|---------|
| ชื่อ · ราคา · หมวด · ตัวเลือก (รายการจาก FS) | FoodStory → ทับลง POS ตอนกดซิงก์ |
| รายการมือบน POS | POS Web |
| recommended / visibleOnPos / ของหมด | POS Web (ซิงก์ไม่ทับถ้าไม่จำเป็น) |
| แก้เมนูบน Native | ห้าม (ยกเว้นของหมดตามที่มี) |

---

## นอกขอบเขตตอนนี้

- ไม่มี API FoodStory อย่างเป็นทางการ → ไม่รอ API
- ไม่ sync ย้อน POS → FoodStory
- ไม่ให้ Native เป็นต้นทางเมนู
- ยังไม่ตั้ง cron อัตโนมัติ (โครงปุ่มพร้อม · ตารางเวลาทีหลังได้)

---

## ค้างยืนยัน (ไม่บล็อกเริ่ม Phase 0)

- บัญชี/สาขา FoodStory ที่ดึง = ชุดเมนูเดียวของ TellTea ใช่ไหม? (สมมติว่าใช่จนกว่าจะบอกแยกสาขา)

---

## ไฟล์ที่คาดว่าจะแตะเมื่อ implement

| พื้นที่ | โดยประมาณ |
|---------|-----------|
| เอกสาร | ไฟล์นี้ |
| Browser capture | `scripts/foodstory-menu-capture.*` (หรือโฟลว์เทียบเท่า) |
| Apply sync | CF หรือสคริปต์เขียน `menu*` + `externalId` |
| หลังร้าน UI | หน้า/พับ **POS → ระบบซิงก์** |
| Types / pos-menu | ฟิลด์ `source` · `externalId` · sync meta |
| Native | แทบไม่แตะ |

---

## สรุป

**กดมือที่หลังร้าน → เบราว์เซอร์ดึงเมนูครบจาก FoodStory → เขียนเข้า POS Web (ทับของที่มาจาก FS · ลบของที่หายจาก FS) → Native รับต่ออัตโนมัติ**
