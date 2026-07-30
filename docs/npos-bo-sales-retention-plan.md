# nPos → หลังร้าน: เก็บยอดขายอย่างไร (แผน)

อัปเดต: **1.14.42**  
เป้าหมาย: ยอดขายจากเคาน์เตอร์ไม่หาย · หลังร้านเห็นรอบ/เครื่อง/ยอดชัด · ไม่เก็บของที่ไม่จำเป็นจนช้า

---

## สิ่งที่เก็บอยู่แล้ว (อย่าทิ้ง)

| ที่ | เก็บอะไร | หมายเหตุ |
|-----|----------|----------|
| **`posSales`** | บิลเต็ม: เมนู+ออปชัน · ยอด · ส่วนลด · ชำระ · เงินทอน · sessionId · deviceId · สถานะ/void | แหล่งจริงของรายงาน |
| **`posSaleMutations`** | idempotency ของบิล | กันซ้ำตอนซิงก์ |
| **`posSessions`** | รอบเปิด/ปิด · saleCount · totalSales · **cashTotal / promptpayTotal สดขณะเปิด** · ทอนเปิด · ปิดกะ blind | บั๊มยอดตอนขาย · ปิดละเอียดตอน Z |
| **แท็บเล็ต outbox** | คิวยังไม่ซิงก์ | local-first — จนกว่า `nposCompleteSale` สำเร็จ |
| **ใบเสร็จ local** | พิมพ์ซ้ำ/void บนเครื่อง | เพดาน ~60 ใบบนเครื่อง |
| **`posDevices.syncPendingCount/Failed`** | สรุปคิวค้างจาก heartbeat | ตารางเครื่องคอลัมน์ **ค้างส่ง** |

**อย่าลบ `posSales` / `posSessions` เป็นค่าเริ่ม**

---

## นโยบายปิดกะ + คิว

| จังหวะ | นโยบาย |
|--------|--------|
| **ระหว่างขาย** | local-first · ทยอย flush เบื้องหลัง |
| **ตอนปิดกะ** | **flush ทันทีแล้วปิดเซิร์ฟ** — ไม่รอ heartbeat countdown · ไม่บล็อกด้วย dialog ลองใหม่ · ออกงานในเครื่องเมื่อ `nposSessionClose` ok |

---

## สถานะเฟส

### P0 — เห็นชัด ✅
- ตารางเครื่อง: รอบ · ของใคร · ยอด · ค้างส่ง

### P1 — บิลค้างไม่หายเงียบ ✅ (1.14.42)
- Heartbeat ส่ง `syncPendingCount` / `syncFailedCount`
- BO คอลัมน์ **ค้างส่ง** (⚠ เมื่อมี failed)
- ปิดกะ: flush ทันทีใน close path (1.14.61+) — ไม่ dialog รอคิว

### P2 — รอบสดบนหลังร้าน ✅ (1.14.42)
- `nposCompleteSale` / void บั๊ม `cashTotal` / `promptpayTotal` บน session เปิด
- BO โชว์ สด / PP บนแถบรอบและคอลัมน์ยอด

### P3 — ฟิลด์เพิ่มเมื่อมี use-case ⬜
| ฟิลด์ | ทำไม | เมื่อไหร่ |
|-------|------|----------|
| `openedByName` / `openedByEmployeeId` | รู้ใครเข้ากะ | **เฟส O1** — [npos-shift-opener-checklist.md](./npos-shift-opener-checklist.md) |
| `cashDropNotes` + สรุปการ์ดรอบ | ตรวจเบิก/นำส่ง | **เฟส O2** — [npos-session-cash-detail-checklist.md](./npos-session-cash-detail-checklist.md) |
| `channel` | วิเคราะห์ช่องทาง | เมื่อเปิดหลายช่องจริง |

แผนรวม: [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)

### ไม่ควรทำ
- เก็บใบเสร็จภาพ/ESC ดิบทุกบิลใน Firestore  
- ให้เว็บปิดกะแทนแท็บเล็ต  
- ล้าง `posSales` อัตโนมัติโดยไม่มี archive  

ดูเพิ่ม: [npos-receipt-history-staff.md](./npos-receipt-history-staff.md)
