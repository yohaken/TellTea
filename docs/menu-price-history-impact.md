---
title: ประวัติราคาเมนู — วิเคราะห์ผลกระทบ + แบบที่ปรับแล้ว
status: analysis-done (ยังไม่สร้าง)
updated: 2026-09-28
project: TellTea
---

# ประวัติราคาเมนู — ผลกระทบต่อระบบ

วิเคราะห์ 5 ด้านพร้อมกัน (read-only): Cloud Functions · ผู้ใช้ข้อมูลเมนู (nPos/POS/ช่องทาง) · เส้นทางแก้ราคา · rules/ความปลอดภัย/ค่าใช้จ่าย · UI/build/เทสต์
ภาพตัวอย่างหน้าจอ: canvas `menu-price-history-mockup`

## สรุป

**ไม่กระทบการขาย / nPos / POS / ช่องทาง** ถ้าทำตามแบบด้านล่าง
ความเสี่ยงอยู่ที่ **ความถูกต้องของประวัติ** และ **rules** — ต้องแก้ 5 เรื่องก่อนสร้าง (§3)

## 1) ส่วนที่ยืนยันแล้วว่าปลอดภัย

| ส่วน | เหตุผล |
|---|---|
| nPos (Java) | อ่านเมนูผ่าน snapshot function ที่เลือกฟิลด์ (`npos-sell.js:117-186`, `npos-menu-admin.js:133-198`) · `org.json opt*` ข้ามฟิลด์แปลก · รีโหลดตาม `meta/pos.menuVersion` เท่านั้น |
| POS เว็บ + แคช | `mapItem` / `mapGroup` อ่านเฉพาะฟิลด์ที่รู้จัก · localStorage เก็บค่าที่ map แล้ว ไม่บวม |
| Hub / สคริปต์ช่องทาง | ใช้ `price`/`name` เป็นหลัก · ไม่มีโค้ดเทียบทั้งเอกสาร |
| การขาย / รายงาน | บิลเก็บราคา ณ ตอนขาย (`PosSaleLine.price`) · ประวัติเป็นข้อมูลดูอย่างเดียว |
| การเขียนเมนู | ทุกเส้นทางใช้ `updateDoc` / `merge:true` · ฟิลด์ใหม่ไม่ถูกลบ |
| Trigger loop | ยังไม่มี trigger ฟัง `menuItems` / `menuOptionGroups` · region `asia-southeast1` ตรงกับ Firestore |
| POS bundle | ตัวแก้เมนูโหลดเฉพาะ `/menu` (เจ้าของ) ไม่ติดไปหน้า POS |
| ต้นทุน (กฎ owner-only) | เก็บแค่ราคาขาย ไม่แตะ `stockCosts` — **ห้าม** join ต้นทุน/มาร์จิ้นในหน้าประวัติ |
| ลำดับหมวด POS | ไม่แตะ `menuCategories.sortOrder` |
| ค่าใช้จ่าย | 193 เมนู / 21 กลุ่มตัวเลือก · ~20–2,000 แถว/เดือน · < 5MB/ปี · trigger อยู่ใน free tier |

## 2) ผลกระทบที่พบ

### สูง
1. **Rules**: collection ใหม่ตกใต้ catch-all → ใครล็อกอิน (รวมลูกค้า/anonymous) ปลอม/ลบ/อ่านประวัติได้ · `allow write: if false` อย่างเดียว**ไม่พอ** เพราะ rules เป็น OR → ต้องเพิ่ม `collection != 'menuPriceHistory'` ใน blocklist (`firestore.rules:49`)
2. **Rules ชนเพดาน**: `assert-firestore-rules.mjs:27-30` บังคับ ≤55 บรรทัด ตอนนี้ 55 พอดี → ต้องเขียนแบบไม่เพิ่มบรรทัด หรือเจ้าของอนุมัติขยายเพดาน
3. **ตัวเมนูเองยังเปิดให้ทุกคนเขียน** (catch-all) → ประวัติจะบันทึกการแก้ของคนนอกเป็น "ของจริง" · เชื่อถือได้เต็มที่เมื่อคืนกฎละเอียด (Lane A ในเช็คลิสต์บั๊ก)
4. **ผู้แก้ค้างค่าเก่า**: สคริปต์ (`restore-menu-store-prices-wongnai.mjs:146`), nPos (`updatedBy=installId`) ไม่ตั้ง `priceUpdatedBy` → trigger ยกเครดิตผิดคน
5. **ผู้แก้ปลอมได้**: client เขียน `priceUpdatedBy` อะไรก็ได้
6. **ประวัติหลอกจากบั๊กเดิม**:
   - ช่องว่าง = 0฿ (Hub, ตารางราคา, ตัวแก้กลุ่มตัวเลือก) → แถว 45→0→45
   - ตัวแก้เมนูส่งราคาจาก state ตอนเปิด → ทับราคาที่คนอื่นแก้ใน Hub → แถว "ราคาย้อน"
   - เซฟกลุ่มตัวเลือกทั้ง array จากข้อมูลเก่า → ทับราคาตัวเลือกอื่น
   - nPos `mapChoice` ทิ้ง `priceDeltaMax` · nPos แสดง `%.0f` → 7.5 กลายเป็น 8
   - nPos ส่ง `price` ทุกครั้งแม้แก้แค่ชื่อ
7. **ราคาช่องทาง (Grab/LINE MAN/Shopee) ไม่อยู่ใน `menuItems`** — อยู่ในเอกสารเดียว `menuPriceHub/settings` (สูตร + override) → trigger บนเมนูมองไม่เห็น

### กลาง
8. **ตัวเลือก id ไม่คงที่**: ลบแล้วเพิ่ม, duplicate, seed `--replace`, Foodstory, nPos สร้าง `c_<ms>` → ต้อง diff ด้วย `options[].id` + เก็บ `nameAtTime` · บันทึกเป็น added/removed ไม่ใช่ราคา 0
9. **ฟิลด์ราคาตัวเลือกไม่ครบในแผนเดิม**: ต้องมี `priceDelta`, `deliveryPriceDelta`, `priceDeltaMax`
10. **Trigger ทำงานทุกการเขียน** (เรียงลำดับ, hubNote, รูป 900KB, ของหมด) → ต้องกรองออกตั้งแต่บรรทัดแรก · ห้าม log/stringify ทั้งเอกสาร
11. **At-least-once**: แถวซ้ำได้ → doc id `${eventId}_${field}_${choiceId|-}` + `create()`
12. **ลำดับ event ไม่รับประกัน** → เก็บ `eventAt` (context.timestamp) ไว้เรียง
13. **Trigger ห้ามเขียนกลับเมนู / `meta/pos`** — ไม่งั้นวนลูป + แท็บเล็ตรีโหลดเมนูบ่อย
14. **Composite index** `itemId + at desc` ต้อง deploy · CI ใช้ `|| true` พังเงียบ → หรือ query `where itemId==` แล้วเรียงฝั่ง client (ไม่ต้องรอ index)
15. **ไม่มี permission `menu`** ในโค้ด (`permissions.ts`) — `/menu` เจ้าของเท่านั้น → เฟสแรกให้เจ้าของดูอย่างเดียว
16. **แยก "หลังร้าน" กับ "Hub" ไม่ได้** เพราะเรียก `updateMenuItem` ตัวเดียวกัน → เพิ่ม parameter `source`
17. **ชื่อฟิลด์ชน**: เอกสารมี `source` (แหล่งสร้าง) / `updatedBy` (installId) อยู่แล้ว → ใช้ prefix `price*` เท่านั้น
18. **สคริปต์ bulk** (`foodstory-menu-apply` เขียนทุก doc ทุกรอบ, seed replace) → ท่วมประวัติ → ติด `source=script:*` + `batchId` ให้ UI กรองได้
19. **PDPA**: เก็บ `staffId` / `uid` / `installId` ไม่เก็บอีเมล/ชื่อ · resolve ชื่อตอนแสดง
20. **UI**: `PosMenuItemEditor.tsx` (520 บรรทัด ไม่มี tab) + เทสต์ห้ามคำ «ลาก» «ใช้เวลา» «ราคาเดลิเวอรี่» ในไฟล์นี้ → ใส่ทุกอย่างในคอมโพเนนต์ใหม่ แตะตัวแก้แค่ 2 บรรทัด
21. **Build**: แก้ไฟล์ `Pos*` → `assert-app-build-bump.mjs` บังคับ bump ทั้ง `APP_BUILD` และ `POS_BUILD` (แท็บเล็ตจะขึ้นแจ้งอัปเดต)

### ต่ำ
22. Deploy functions ใหม่ = redeploy ~90 function (`--force`) · ช่วงแรกหลัง deploy trigger อาจยังไม่ยิงไม่กี่นาที
23. ย้อนหลังก่อนเปิดระบบไม่มี — แต่ backfill บางส่วนได้จาก `scripts/data/menu-price-baseline/restore-log-*.json` (มี from→to)
24. ไม่มีไลบรารีกราฟ → วาด SVG เองตามแบบ `PosSalesDashboardCharts.tsx` (ไม่เพิ่ม bundle)
25. Retention: TTL ต้องใช้ฟิลด์ Timestamp (`expireAt`) — ปริมาณน้อย เก็บ 24 เดือนได้

## 3) แบบที่ปรับแล้ว

**เก็บ**
- Trigger 2 ตัว (v2 `onDocumentWrittenWithAuthContext` ถ้าได้ — ได้ uid ผู้เขียนจริงจาก client · Admin SDK จะเป็น service account → ใช้ฟิลด์ที่ function ตั้ง) บน `menuItems/{id}`, `menuOptionGroups/{id}` · 256MB · `asia-southeast1`
- กรองเร็ว: เทียบเฉพาะ `price`, `deliveryPrice` (null = ใช้ราคาหน้าร้าน ≠ 0) และ tuple `id:priceDelta:deliveryPriceDelta:priceDeltaMax` · เท่ากัน → return
- เขียนเฉพาะ `menuPriceHistory` · doc id กำหนดได้ · ห้ามแตะเมนู/`meta/pos`
- แถว: `itemId|groupId`, `choiceId?`, `kind` (price_changed / created / deleted / choice_added / choice_removed / field_removed), `field`, `from`, `to`, `at`, `eventAt`, `nameAtTime`, `source`, `by` (id), `batchId?`, `suspect?` (to=0 / ปัด <1 จาก nPos / A→B→A ภายในวินาที)
- `by`/`source` จาก client เชื่อเมื่อ `priceUpdatedAt === updatedAt` เท่านั้น ไม่งั้น `unknown`

**Rules (ไม่เพิ่มบรรทัด)** — อ่านเจ้าของ · เขียน false · เพิ่มชื่อใน blocklist บรรทัดเดิม
**Query** — `where itemId==` + limit แล้วเรียงฝั่ง client (เฟสแรกไม่ต้องรอ index) · `getDocs` ไม่ `onSnapshot` ค้าง
**UI** — `src/lib/menu-price-history.ts` + `src/components/MenuPriceHistory.tsx` (การ์ดพับได้ ปิดไว้ โหลดตอนเปิด) · ตัวแก้เมนูเพิ่ม 2 บรรทัด · กราฟขั้นบันได SVG · วันที่ `formatDateTimeShort` (พ.ศ.) · ซ่อนแถว `suspect`/script ได้

## 4) ลำดับทำ (เสนอ)

| เฟส | งาน | ขึ้นกับ |
|---|---|---|
| P0 | แก้บั๊กที่ทำประวัติหลอก: D1 (ว่าง=0), D9 (ตัวแก้ส่งราคาเก่า), D7 (กลุ่มตัวเลือกทับ), D8 (`priceDeltaMax`) | เช็คลิสต์บั๊ก Lane D |
| P1 | Rules blocklist + trigger + เทสต์ `test-menu-price-history.mjs` | — |
| P2 | ส่ง `priceUpdatedBy/Source/At` จาก `updateMenuItem`, `saveMenuOptionGroupFull`, `npos-menu-admin.js` (เฉพาะเมื่อราคาเปลี่ยนจริง) | P1 |
| P3 | UI การ์ดประวัติราคา (กราฟ + ตาราง) | P1 |
| P4 | Seed จุดเริ่มต้น (ราคาปัจจุบันทุกเมนู) + backfill จาก `restore-log-*.json` | P1 |
| P5 | ประวัติราคาช่องทาง: trigger บน `menuPriceHub/settings` (diff override รายเซลล์ · เปลี่ยนสูตร = 1 แถวระดับร้าน) | P1 |

## 5) ต้องให้เจ้าของตัดสิน

1. Rules: เขียนรวมบรรทัดเดิม (แนะนำ) หรือขยายเพดาน 55 บรรทัด
2. ทำ P0 (แก้บั๊กราคา) ก่อน หรือเปิดประวัติเลยแล้วติดธง `suspect`
3. ใครดูได้: เจ้าของอย่างเดียว (แนะนำเฟสแรก) หรือเพิ่มสิทธิ์ `menu` ให้พนักงาน
4. บันทึกการสร้าง/ลบเมนูด้วยไหม · แสดงแถวจากสคริปต์ไหม
5. เอาราคาช่องทาง (P5) ในรอบนี้เลยไหม
