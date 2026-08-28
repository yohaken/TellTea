# เฟส: Refactor `firestore.rules` ให้สั้น (≤50 บรรทัด)

> เป้าหมาย: ร้านชานมพนักงาน ~5 คน · ล็อกอินแล้วทำงานได้ · ตัดฟังก์ชันซ้ำ · deploy ผ่าน Rules API (ชุดใหญ่โดน 503)
>
> **ไม่เกี่ยวกับ** Cursor rule ของ P-Note / `mynote-inews.web.app`

---

## Concept (คงไว้ตลอด)

| Who | Action | Where |
|-----|--------|--------|
| ล็อกอิน (staff/owner) | อ่าน + เขียนงานร้าน | ledger, ผลิต, ชง, เช็ค, คลัง, พนักงาน, โบนัส, meta, POS… |
| เจ้าของอีเมลเท่านั้น | จัดการสมาชิก / VAT / บางอย่างที่ sensitive | members*, vat*, owner-only |
| ผู้ใช้ sibling app | เฉพาะ doc ของตัวเอง | `taxtag/{uid}`, `userData/{uid}` |
| คนนอก | ไม่ได้อะไร | default deny |

---

## Phase 0 — ยืนยันปัญหา (ทำแล้ว)

- [x] Live rules = emergency-slim Jul 2025 (`hasPerm` พัง → ledger/prod/ot 403)
- [x] Staff data OK: `full_access` + `permissions.ledger:true`
- [x] Rules API: ไฟล์เล็ก (~deny-all) สร้างได้ · emergency ~11KB / full ~65KB → **503**
- [x] Callable fallback (bonus/prod/ledger) ไม่พอแก้ทุกหน้า (เช็ค/คลังยัง client rules)

---

## Phase 1 — เขียน rules ใหม่สั้น (≤50 บรรทัด)

- [x] สร้าง `firestore.rules` ชุดใหม่: `signedIn` → เข้าคอลเลกชันร้านได้
- [x] คง sibling: `taxtag` / `userData` = owner-of-doc เท่านั้น
- [x] ไม่มี `hasPerm` / `levelPerms` / ฟังก์ชันซ้ำ — UI กรองเมนูเอง
- [x] อัปเดต `scripts/assert-firestore-rules.mjs` ให้รองรับโมเดลสั้น

**เกณฑ์ผ่าน:** `wc -l firestore.rules` ≤ 50 · `npm run test:firestore-rules` ผ่าน

---

## Phase 2 — Deploy rules ขึ้น production

- [x] `node scripts/deploy-firestore-rules-rest.mjs`
- [x] `npm run verify:firestore-rules` → ruleset ใหม่
- [ ] ถ้า 503 อีก → (ไม่ต้อง — slim deploy ผ่านแล้ว)

**เกณฑ์ผ่าน:** verify แสดง createTime วันนี้ + มี marker `signedIn` / ไม่มี `levelPerms`

---

## Phase 3 — ทดสอบพนักงานจริง (เป้)

- [ ] Logout → login อีเมล+เบอร์
- [ ] บัญชี: มีรายการ + ยอดคงเหลือ (ไม่มี “สิทธิ์ไม่พอ”)
- [ ] ผลิต / ชง / จ่าย / เช็ค / คลัง: โหลดได้
- [ ] Owner Google: โอนเข้า / สมาชิก ยังใช้ได้

**เกณฑ์ผ่าน:** เป้เปิดบัญชีแล้วเห็นข้อมูลจริง ไม่ขึ้น Missing permissions

---

## Phase 4 — เก็บกวาดหลัง rules ขึ้น

- [ ] เก็บ callable bundle ไว้เป็น fallback (ไม่ลบทันที)
- [x] อัปเดต `firestore.rules.emergency` ให้ตรงชุดสั้น (สำรอง)
- [x] อัปเดต checklist / README ว่า canonical = ชุดสั้น
- [ ] Bump APP_BUILD + push main → hosting ตามปกติ

---

## Phase 5 — (ถ้าต้องการ) แยกสิทธิ์เบาๆ ภายหลัง

เฉพาะเมื่อ UI ไม่พอ เช่น พนักงานห้ามแก้สมาชิก:

- [ ] เพิ่ม 5–10 บรรทัด: `isOwnerEmail()` สำหรับ `members*`, `vat*`
- [ ] ยังไม่กลับไปโมเดล `hasPerm` ต่อ collection

---

## สิ่งที่ไม่ทำในเฟสนี้

- ไม่ refactor โค้ด UI สิทธิ์เมนู
- ไม่รอ Rules API รับไฟล์ 1,400 บรรทัด
- ไม่ deploy จาก sibling repo
- ไม่ใช้กฎ P-Note กับ TellTea

---

*Phase 1–2 ทำแล้ว 2026-08-28 — รอ Phase 3 ทดสอบในเบราว์เซอร์*
