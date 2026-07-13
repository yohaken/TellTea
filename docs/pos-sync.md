# POS Offline & Sync — สถาปัตยกรรม (Phase 4 + Local-first)

> อัปเดต 2026-07-13 · v134

## เป้าหมาย

ขายหน้าร้านได้ทันที (**local-first**) — บันทึกลงเครื่องก่อน แสดงสำเร็จทันที ส่งขึ้นเซิร์ฟเวอร์เบื้องหลัง โดย **ไม่ซ้ำบิล** (idempotent)

---

## ชั้นสถาปัตยกรรม

```
┌─────────────────────────────────────────┐
│ POS UI (PosSellView)                     │
└───────────────┬─────────────────────────┘
                │
        completeCashSale / completePromptPaySale
                │
                ▼ ทุกครั้ง (online/offline)
         IndexedDB outbox + แสดงสำเร็จทันที
         telltea-pos-sync · บิล รอส่ง-XXXXXX
                │
                │ runPosSyncFlush() (background)
                │ PosSyncWatcher flush ทุก 12s + เมื่อ online
                ▼
         posCompleteSale CF (asia-southeast1)
                │
                │ idempotency posSaleMutations/
                ▼
 Firestore: posSales, meta/pos, posSessions
```

| ชั้น | ไฟล์ | หน้าที่ |
|------|------|--------|
| Outbox | `src/lib/pos-outbox.ts` | คิวบิลรอส่ง (IndexedDB) |
| Sync | `src/lib/pos-sync.ts` | flush → `posCompleteSale` |
| Watcher | `src/components/PosSyncWatcher.tsx` | background sync |
| Sale API | `src/lib/pos-sales.ts` | **enqueue เสมอ** → flush เบื้องหลัง |
| Server | `functions/pos-complete-sale.js` | transaction + idempotency |
| Session UI | `PosSellView` + `computeSessionPendingOverlay` | ยอดกะ = Firestore + pending outbox |
| Cache อ่าน | `src/lib/pos-firebase.ts` | Firestore `persistentLocalCache` เมนู |

---

## กฎธุรกิจ

1. **กดขายสำเร็จบนเครื่องทันที** — ไม่รอ Cloud Function; แสดง "บันทึกแล้ว"
2. **เลขบิลจริง** (`Pddmm-001`) ออกที่เซิร์ฟเวอร์ตอน sync เท่านั้น — ก่อนหน้านั้น `รอส่ง-XXXXXX`
3. **`clientMutationId`** หนึ่งครั้ง = หนึ่งบิล — retry / replay ไม่ซ้ำ (`posSaleMutations/{id}`)
4. **ยอดกะบนจอ** = `posSessions` จาก Firestore **+** บิล pending ใน outbox ของกะนั้น (ไม่ bump กะฝั่ง client — ป้องกัน double-count)
5. **ห้าม reload / อัปเดตแอป** ถ้ามีบิลค้าง (`pendingSyncCount > 0`)
6. **PromptPay** — QR ต้องมีเน็ตตอนสร้าง; ยืนยันขาย = local-first เหมือนเงินสด
7. **ปิดรอบ (POS 30+)** — ปิดบนเครื่องทันทีเสมอ; บิลค้างซิงก์เบื้องหลัง; **ห้ามรอ Firebase / ห้ามค้างปุ่ม**
8. **พิมพ์ใบเสร็จ** — ชั้นเว็บยังผ่าน browser dialog (ข้อจำกัดแพลตฟอร์ม); silent print ต้อง Android shell ภายหลัง
9. **Boot (POS 30+)** — สร้าง/อ่าน device id บนเครื่องทันที → UI พร้อม; auth/register เงียบด้านหลัง

### นโยบาย Local-first → sync เงียบ

| การกระทำ | บนเครื่อง | เครือข่าย |
|----------|-----------|-----------|
| Boot | device id + กะ + เมนูแคชทันที | auth / register / reconcile เงียบ |
| ขาย | สำเร็จทันที + outbox | flush เมื่อออนไลน์ |
| เปิดกะ | เปิดทันที | persist เบื้องหลัง |
| ปิดกะ | ปิดทันทีเสมอ | flush บิลแล้วค่อยปิดเซิร์ฟ |
| ตั้งค่าร้าน / PromptPay | localStorage ก่อน | snapshot อัปเดตเงียบ |
| เมนู | cache ข้อความก่อน (เบา) · รูปแยก hydrate ทีหลัง | subscribe / seed เงียบ |
| รูปเมนู | placeholder ก่อน · lazy / idle | ไม่บล็อกแตะขาย |

ถ้า CF/Firestore ช้าหรือขาด — **UI ไม่ค้าง**; บิล/สถานะรอบค้างในเครื่องแล้วค่อยซิงก์เมื่อเน็ตกลับ

> พิมพ์: พนักงานอาจยังเจอ confirm ของเบราว์เซอร์ — ไม่ใช่บั๊ก sync; แก้จบที่ native print bridge

---

## สถานะบิล

| สถานะ | ความหมาย | UI |
|--------|----------|-----|
| synced | ขึ้น Firestore แล้ว | เลขบิล `P1307-001` |
| pending | อยู่ใน outbox | `รอส่ง-ABC123` + ป้าย **รอส่ง N** |
| syncing | กำลัง flush ขึ้นเซิร์ฟเวอร์ | ป้าย **กำลังส่งข้อมูล** (แทน รอส่ง N ชั่วคราว) |
| failed (ถาวร) | invalid-argument ฯลฯ | ค้างใน outbox + `lastError` |

---

## Error → พฤติกรรม (ตอน flush)

| Error | ทำอะไร |
|-------|--------|
| `functions/unavailable`, network | retry ใน outbox |
| `functions/internal` | retry ใน outbox |
| `functions/invalid-argument` | mark failed ใน outbox |
| `functions/permission-denied` | mark failed ใน outbox |

การขายครั้งแรกไม่บล็อก UI — error จากเซิร์ฟเวอร์จัดการใน sync layer

---

## งานถัดไป (ไม่บล็อก)

- [x] UI รายการบิลค้าง + ปุ่ม "ส่งอีกครั้ง" (v132)
- [x] แจ้งเตือนเจ้าของเมื่อค้าง > 5 นาที (`posDevices.syncStuckAt`)
- [x] Void บิลที่ยัง pending (ยกเลิก local)
- [x] Local-first sale + session overlay (v134)
- [ ] Emulator e2e กับ Firebase Auth จริง

---

## ไฟล์ทดสอบ

- `npm run test:pos-sync` — retry / bill label utils
- `npm run test:pos-sales-local-first` — local-first + session overlay
- `npm run test:pos-complete-sale` — ลำดับ read/write transaction
- `npm run test:pos-connectivity` — wiring

ดูเพิ่ม: `docs/pos-connectivity.md`, `docs/pos-sale.md`
