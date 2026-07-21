# นโยบายโดเมน POS — แยกจากหลังร้าน TellTea

> อัปเดต 2026-07-13 · v135

## หลักการ

1. **POS = ระบบขายหน้าร้านแยกต่างหาก** — ข้อมูล `posSales`, `posSessions`, `posDevices`, `meta/pos`
2. **หลังร้าน = บริหารร้าน** — `ledger`, `stock`, OT, PnL, ฯลฯ
3. **ไม่ sync ข้อมูลข้ามโดเมน** — POS ไม่เขียน ledger / stock / monthlyIncome
4. **หน้าต่างเจ้าของ** — `/pos-sales/` รายงานยอดขาย (+ แท็บ **จัดการ Pos** ว่างไว้ชั่วคราว)

## URL แยก (v135+)

| ระบบ | URL |
|------|-----|
| หลังร้าน TellTea | https://telltea-shop.web.app/ |
| POS แท็บเล็ต | **https://telltea-pos.web.app/pos/** |
| รายงาน + จัดการ Pos (เจ้าของ) | https://telltea-shop.web.app/pos-sales/ |

URL เก่า `telltea-shop.web.app/pos/` → redirect 301 ไป `telltea-pos.web.app`

## Hosting แยก

| Firebase site | โฟลเดอร์ | เนื้อหา |
|---------------|----------|---------|
| `telltea-shop` | `out/` | หลังร้านเท่านั้น (ไม่มี `/pos/`) |
| `telltea-pos` | `out-pos/` | POS standalone ที่ root `/` |

Build: `npm run build` → `split-pos-hosting.mjs` แยก output อัตโนมัติ

## สิ่งที่ห้ามทำ

- เขียน `ledger` จาก POS
- หัก `stock` จากบิล POS (ยกเลิก Phase 6 แบบเดิม)
- ดึง `posSales` → `monthlyIncome` อัตโนมัติ (ยกเลิก Phase 7)
- ใส่ `/pos/` กลับเข้า hosting หลังร้าน

## สิ่งที่ยังร่วมกัน (ไม่ใช่การเชื่อมข้อมูล)

- Firebase project เดียว (`mypeer-501909`)
- แท็บ `/pos-sales/?tab=manage` ว่างไว้ชั่วคราว · สลิป/ชำระเงินบนแท็บเล็ต `/pos/settings/` จนกว่าจะโยก native ครบ (เว็บ POS ยังไม่ลบ)
- Cloud Functions: `posCompleteSale`, `posDeviceAuth`

ดูเพิ่ม: `docs/pos-sync.md`, `docs/pos-connectivity.md`
