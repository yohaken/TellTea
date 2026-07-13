# POS Offline & Sync — สถาปัตยกรรม (Phase 4)

> อัปเดต 2026-07-13 · v129+

## เป้าหมาย

ขายหน้าร้านได้แม้ **Wi‑Fi หลุดชั่วคราว** — บิลเก็บในเครื่องก่อน ส่งขึ้นเซิร์ฟเวอร์เมื่อกลับ online โดย **ไม่ซ้ำบิล** (idempotent)

---

## ชั้นสถาปัตยกรรม

```
┌─────────────────────────────────────────┐
│ POS UI (PosSellView)                     │
└───────────────┬─────────────────────────┘
                │
        completeCashSale / completePromptPaySale
                │
     ┌──────────┴──────────┐
     │ online?              │
     ▼ yes                  ▼ no / retryable error
 posCompleteSale CF    IndexedDB outbox
 (asia-southeast1)      telltea-pos-sync
     │                      │
     │ idempotency          │ PosSyncWatcher
     │ posSaleMutations/    │ flush ทุก 12s + เมื่อ online
     ▼                      ▼
 Firestore: posSales, meta/pos, posSessions
```

| ชั้น | ไฟล์ | หน้าที่ |
|------|------|--------|
| Outbox | `src/lib/pos-outbox.ts` | คิวบิลรอส่ง (IndexedDB) |
| Sync | `src/lib/pos-sync.ts` | flush → `posCompleteSale` |
| Watcher | `src/components/PosSyncWatcher.tsx` | background sync |
| Sale API | `src/lib/pos-sales.ts` | online ก่อน → queue ถ้าจำเป็น |
| Server | `functions/pos-complete-sale.js` | transaction + idempotency |
| Cache อ่าน | `src/lib/pos-firebase.ts` | Firestore `persistentLocalCache` เมนู |

---

## กฎธุรกิจ

1. **กดขายสำเร็จบนเครื่องเสมอ** ถ้าเงินพอ / ตะกร้าไม่ว่าง — แม้ offline ได้บิล `รอส่ง-XXXXXX`
2. **เลขบิลจริง** (`Pddmm-001`) ออกที่เซิร์ฟเวอร์ตอน sync เท่านั้น
3. **`clientMutationId`** หนึ่งครั้ง = หนึ่งบิล — retry ไม่ซ้ำ (`posSaleMutations/{id}`)
4. **ห้าม reload / อัปเดตแอป** ถ้ามีบิลค้าง (`pendingSyncCount > 0`)
5. **PromptPay offline** — เก็บคิวได้ แต่ QR ต้องมีเน็ตตอนสร้าง; ยืนยันขาย offline = คิวรอส่ง

---

## สถานะบิล

| สถานะ | ความหมาย | UI |
|--------|----------|-----|
| synced | ขึ้น Firestore แล้ว | เลขบิล `P1307-001` |
| pending | อยู่ใน outbox | `รอส่ง-ABC123` + ป้าย **รอส่ง N** |
| syncing | กำลัง flush ขึ้นเซิร์ฟเวอร์ | ป้าย **กำลังส่งข้อมูล** (แทน รอส่ง N ชั่วคราว) |
| failed (ถาวร) | invalid-argument ฯลฯ | ค้างใน outbox + `lastError` (อนาคต: แจ้งเจ้าของ) |

---

## Error → พฤติกรรม

| Error | ทำอะไร |
|-------|--------|
| `functions/unavailable`, network | ใส่ outbox + แสดงสำเร็จรอส่ง |
| `functions/internal` | ใส่ outbox (retry) |
| `functions/invalid-argument` | แสดง error ไม่ queue |
| `functions/permission-denied` | แสดง error ไม่ queue |

---

## งานถัดไป (ไม่บล็อก Phase 4)

- [x] UI รายการบิลค้าง + ปุ่ม "ส่งอีกครั้ง" (v132)
- [x] แจ้งเตือนเจ้าของเมื่อค้าง > 5 นาที (`posDevices.syncStuckAt`)
- [x] Void บิลที่ยัง pending (ยกเลิก local)
- [ ] Emulator e2e กับ Firebase Auth จริง

---

## ไฟล์ทดสอบ

- `npm run test:pos-sync` — retry / bill label utils
- `npm run test:pos-complete-sale` — ลำดับ read/write transaction
- `npm run test:pos-connectivity` — wiring

ดูเพิ่ม: `docs/pos-connectivity.md`, `docs/pos-sale.md`
