# nPos — BO force-close ↔ tablet sync (cooperative)

อัปเดต: **1.14.66** · `APP_BUILD` 325 · `POS_BUILD` 119 · vc **89**

## มติ (ไม่เชิงป้องกันเสมอ)

| ข้อ | ทำ |
|-----|----|
| ช่องทาง | ใช้ **heartbeat เดิม** — ส่ง `sessionId` · รับ `sessionRemoteClosed` |
| เตะ ≠ ปิดกะ | BO ปิดรอบ **ไม่** revoke seat / ไม่เด้งใส่รหัส |
| จบตะกร้าได้ | ถ้ามีบิลค้างในตะกร้า — ขายจบได้ แล้วค่อยออกจากหน้าขาย |
| ไม่ชุบชีวิตรอบปิด | `nposSessionOpen` ปฏิเสธ merge เปิดซ้ำบน doc ที่ `closed` |
| Z หลัง BO | `nposSessionClose` รับ finalize เงินสดบนรอบที่ปิดแล้ว · คง `closedAt` เดิม |
| บิลหลังปิด | outbox ยังซิงก์บิลได้ (เงินไม่หาย) · ยอดรอบบนเซิร์ฟเวอร์ไม่บวกต่อ |

## Flow

```text
BO closePosSessionAdmin (closeSource=bo-force)
  → Firestore status=closed
  → next heartbeat (~5s): sessionRemoteClosed=true
  → ShiftPrefs.applyRemoteSessionClosed (pending)
  → Sell: จบตะกร้าถ้ามี → settle → hub (seat ยังอยู่)
  → เปิดรอบใหม่เมื่อพร้อม
```

## ตรวจ

```bash
node scripts/test-npos-bo-close-sync.mjs
```
