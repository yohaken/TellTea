# POS Connectivity & Update — สถาปัตยกรรมภายใน

> อ้างอิงถาวรสำหรับ Phase 0+ · อัปเดต 2026-07-13

## หลักการ

1. **Firestore = สายชีวิต** — heartbeat, session, menu, คำสั่งรีเฟรช ไม่พึ่ง WebSocket
2. **Deploy โค้ด ≠ ตัดการเชื่อมต่อ** — Firebase Hosting สลับ static แบบ atomic; แท็บเล็ตยังคุย Firestore ได้จนกว่าจะ reload หน้า
3. **Reload มีช่วงสั้น ~2–5 วิ** — ป้ายออฟไลน์อาจกระพริบ; ถ้า heartbeat กลับภายใน 3 นาที เจ้าของยังเห็นออนไลน์
4. **ห้าม reload กลางการขาย** — ตะกร้าว่าง + ไม่เปิด modal ชำระเงิน + ไม่กำลังบันทึกบิล

## ชั้นที่ทำงานแล้ว (v119+)

| ชั้น | หน้าที่ | ช่วง |
|-----|--------|------|
| Anonymous Auth | ตัวตนเครื่อง POS | ถาวร (local) |
| `posDevices` heartbeat | `lastSeenAt` ทุก 60s | ออนไลน์ = เห็นสัญญาณภายใน 3 นาที |
| `posSessions` | เปิดกะ / ยอดขายค้างหลัง reload | ต่อกะเดิมอัตโนมัติ |
| `forceReloadAt` | เจ้าของสั่งรีเฟรชจาก Settings | รอตะกร้าว่างก่อน reload |
| `PosUpdateWatcher` | poll `/version.json` + `forceAppUpdate` | อัปเดตโค้ดโดยไม่ต้องสั่งมือ |
| Menu seed | สร้างเมนูตัวอย่างถ้าว่าง | ครั้งแรกที่เชื่อมต่อ |

## การอัปเดตโค้ด — จะขาดช่วงไหม?

| เหตุการณ์ | ผลกับ Firestore | ผลกับหน้าจอ POS |
|-----------|----------------|-----------------|
| Push `main` → deploy | ไม่ขาด | JS เก่าจนกว่าจะ reload |
| แท็บเล็ตไม่ reload | heartbeat ยังทำงาน | ใช้ build เก่า |
| Owner เปิด **บังคับอัปเดต** | ไม่ขาด | reload เมื่อว่าง (≤30s หลังหยุดแตะ) |
| Owner กด **รีเฟรชเครื่อง** | ไม่ขาด | reload เมื่อว่าง |
| POS reload กลางวัน | หยุด heartbeat ชั่วคราว | กลับมาเปิดกะเดิมอัตโนมัติ |

**สรุป:** การ deploy **ไม่ทำให้** POS หลุดจาก Firestore; มีแค่ช่วงสั้นตอน reload หน้าเท่านั้น

## สิ่งที่ยังไม่ทำ (Phase ถัดไป)

| ช่องว่าง | เหตุผลที่ยังไม่ทำ |
|---------|------------------|
| คิวขาย offline | ซับซ้อน — ต้อง IndexedDB + sync ย้อนหลัง |
| Service Worker cache bust POS | ใช้ poll version + reload แทน |
| Auto-reload ทุกเครื่องหลัง deploy | ใช้ forceAppUpdate หรือปุ่มอัปเดตทุกเครื่องแทน |
| T-B6 สถานะเครื่องพิมพ์/เน็ตละเอียด | Phase 2 ฮาร์ดแวร์ |

## Checklist เจ้าของ

- [ ] Firebase → Authentication → **Anonymous Enable**
- [ ] หลัง deploy ใหญ่: Settings → **บังคับอัปเดต** หรือกด **อัปเดตเครื่องที่ค้าง**
- [ ] ดูออนไลน์ที่ Settings → เครื่อง POS (heartbeat 3 นาที)

## ไฟล์หลัก

| ไฟล์ | บทบาท |
|------|--------|
| `src/lib/pos-devices.ts` | heartbeat, forceReload |
| `src/lib/pos-reload.ts` | กฎ reload ปลอดภัย |
| `src/components/PosUpdateWatcher.tsx` | auto-update POS |
| `src/components/AppUpdateWatcher.tsx` | auto-update หลังร้าน |
| `src/lib/app-release.ts` | `forceAppUpdate` ร่วมกัน |
| `scripts/smoke-hosting-export.mjs` | กัน 404 หลังร้าน |
