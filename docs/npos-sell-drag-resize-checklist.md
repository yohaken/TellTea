# nPos — sell drag-resize layout (แถบเลื่อนแกน X)

อัปเดต: **1.14.64** · `APP_BUILD` 322 · `POS_BUILD` 117 · vc **87**

## มติ

เหมาะกับเคาน์เตอร์: พนักงานเลื่อนเส้นแบ่งเอง ไม่ให้เจ้าของ fix น้ำหนักถาวร

| ข้อ | ทำ |
|-----|----|
| ค่าเริ่ม | หมวด / เมนู / ตะกร้า = **14 / 51 / 35** |
| แถบเลื่อน | `splitCatMenu` · `splitMenuCart` — แตะแล้วลากแกน X |
| เพดาน | หมวด ≤35% · ตะกร้า ≤35% · เมนู ≥30% (`SellLayoutPrefs`) |
| จำค่า | SharedPreferences `npos_sell_layout` |
| สเกลฉลาด | คอลัมน์เมนูจากความกว้างจริง · ไทล์หดตาม X (ไม่ดัน Y) · ตัวอักษรหมวด/ตะกร้าปรับตามความกว้างแผง |

```bash
node scripts/test-npos-sell-drag-resize.mjs
node scripts/test-npos-cart-layout-touch.mjs
```
