# นโยบายโดเมน POS — แยกจากหลังร้าน TellTea

> อัปเดต 2026-07-22 · ตัดเว็บเคาน์เตอร์ · ใช้ nPos

## หลักการ

1. **POS ขายหน้าร้าน = แอป nPos-telltea** — ไม่ใช้เว็บ `/pos/sell` อีก
2. **หลังร้าน = บริหารร้าน** — `ledger`, `stock`, OT, PnL, เมนู, รายงาน POS
3. **ไม่ sync ข้อมูลข้ามโดเมน** — POS ไม่เขียน ledger / stock / monthlyIncome
4. **หน้าต่างเจ้าของ** — `/pos-sales/` รายงานยอดขาย + แท็บจัดการ (เครื่อง nPos · ตั้งค่าร้าน)

## URL

| ระบบ | URL |
|------|-----|
| หลังร้าน TellTea | https://telltea-shop.web.app/ |
| รายงาน + ตั้งค่า + จัดการ nPos (เจ้าของ) | https://telltea-shop.web.app/pos-sales/ |
| ติดตั้ง / อัปเดต APK | **https://telltea-pos.web.app/install/** |
| เว็บ `/pos/*` เคาน์เตอร์ | **เลิกใช้** — หน้า stub ชี้ไป nPos |

URL เก่า `telltea-shop.web.app/pos/` → redirect ไป `telltea-pos.web.app/pos/...` (stub)

## Hosting

| Firebase site | โฟลเดอร์ | เนื้อหา |
|---------------|----------|---------|
| `telltea-shop` | `out/` | หลังร้าน |
| `telltea-pos` | `out-pos/` | `/install/` · `/downloads/` · stub `/pos/*` |

**ห้ามลบไซต์ telltea-pos ทั้งก้อน** — ยังโฮสต์ APK / หน้าติดตั้ง

## สิ่งที่ห้ามทำ

- เขียน `ledger` จาก POS
- หัก `stock` จากบิล POS
- ดึง `posSales` → `monthlyIncome` อัตโนมัติ
- เปิดลิงก์จากเคาน์เตอร์ (nPos) เข้าหลังร้าน
- กลับไปขายบนเว็บ `/pos/sell`

ดูเพิ่ม: `docs/pos-sync.md`, `docs/npos-telltea.md`
