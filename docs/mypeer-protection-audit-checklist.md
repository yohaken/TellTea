# เช็คลิสต์: การป้องกัน / ข้อจำกัด AI บนโปรเจกต `mypeer-501909`

> ใช้เมื่อสงสัยว่า “AI ถูกสั่งห้ามทำ” หรือ deploy/rules ไม่ขึ้น — แยกให้ชัดว่าอะไรเป็น **กฎที่ตั้งเอง** vs **ข้อจำกัดทางเทคนิค**

---

## A. กฎใน Cursor (User / Project Rules)

- [ ] เปิด **Cursor → Settings → Rules** ดู User Rules ทั้งหมด
  - ค้นหา: `mypeer`, `501909`, `firestore`, `ห้าม`, `deploy`, `delete`, `Smart Mode`
  - บันทึกข้อความที่พบ (copy มาแปะใน PR/issue ถ้ามี)
- [ ] เปิด **Project Rules** ใน repo TellTea (`.cursor/rules/`)
  - ปัจจุบันมีแค่ `npos-friendly-ui.mdc` — **ไม่เกี่ยวกับ mypeer / Firestore**
- [ ] ตรวจแชทเก่า (ถ้าจำได้ว่าเคยสั่ง “ห้ามยุ่ง mypeer”) — rule อาจอยู่แค่ใน User Rules ไม่ได้ commit ลง git
- [ ] ถ้ามี rule ห้าม deploy rules → **ระบุข้อยกเว้น**: “กู้คืน `firestore.rules` ชุดเต็มของ TellTea ได้เมื่อถูก sibling ทับ”

**สถานะที่ตรวจแล้ว (2026-08-28):** ใน repo TellTea **ไม่พบ** Cursor rule ห้ามแก้ mypeer — มีแต่ guard ในโค้ด/CI (ด้านล่าง)

---

## B. Guard ใน repo TellTea (โค้ด / CI)

- [ ] `scripts/assert-firestore-rules.mjs` — CI **fail deploy** ถ้า `firestore.rules` ขาด collection สำคัญ (ledger, staff, bonus, …)
- [ ] `README.md` + `scripts/templates/SHARED_FIREBASE_CHECKLIST.md`
  - แอป sibling (TaxTag, Cal Tracker, …) **ห้าม** `firebase deploy --only firestore` จาก repo ตัวเอง
  - ต้อง merge rules เข้า `firestore.rules` ของ TellTea แล้ว deploy จาก repo นี้
- [ ] `.github/workflows/deploy.yml`
  - Hosting/functions ขึ้นได้แม้ Rules API 503 (`WARN` แล้ว `exit 0`)
  - **ไม่ได้ห้าย deploy** — แต่ rules อาจไม่ตาม commit
- [ ] `.github/workflows/deploy-firestore-rules.yml` — workflow แยก deploy rules (+ REST fallback → `firestore.rules.emergency`)
- [ ] `firestore.rules.emergency` — rules สั้นเมื่อ full file โดน Firebase 503 (ไม่ใช่ “ห้ามแตะ” แต่เป็น fallback)

**คำสั่งตรวจ live rules:**

```bash
npm run verify:firestore-rules
# emergency-slim = ยังไม่ใช่ชุดเต็มใน firestore.rules
# full = ชุดเต็ม live แล้ว
```

---

## C. Smart Mode / Sandbox (Cursor Agent)

- [ ] ถ้า agent รัน `firebase deploy` / REST rules แล้วโดนบล็อก — ดูว่าเป็น **Auto-review / Smart Mode** หรือ **Firebase API 503**
- [ ] Firebase 503 → retry: `node scripts/deploy-firestore-rules-retry.mjs` หรือ workflow `deploy-firestore-rules.yml`
- [ ] 503 **ไม่ใช่** “ห้ามแก้ rules” — เป็น outage/ขนาดไฟล์ ของ Google Rules API

---

## D. สาเหตุที่พนักงาน “เมื่อวานเห็นบัญชี / วันนี้ไม่เห็น” (แยกจาก “ห้าม AI”)

เมื่อวาน vs วันนี้ — ไล่ตามลำดับนี้:

- [ ] **Live rules บน production** ยังเป็น `emergency-slim` (Jul 2025) — `npm run verify:firestore-rules`
- [ ] **hasPerm() พังบน live rules** — staff มี `full_access` + `permissions.ledger:true` แต่ list `/ledger` ยัง 403 (ยืนยัน 2026-08-28 ด้วย user token)
- [ ] **Rules deploy 503** — emergency ~11KB ยังโดน 503 · workaround = Cloud Function bundle
- [ ] **Commit คืนนี้** ที่กระทบ staff login / สิทธิ์:
  - email+phone login, auth token sync, `full_access` level, staff bundle callables
- [ ] Staff doc: `permissionLevelId`, `permissions`, `permissionsCustomized`
- [ ] ทดสอบบัญชีเดิม (เช่น เป้): logout → hard refresh → login → หน้า **บัญชี**
- [ ] Console error: `Missing or insufficient permissions` = **Firestore rules** (ไม่ใช่เมนูสิทธิ์ UI)
- [ ] ถ้า rules deploy 503 ค้าง: ใช้ **Cloud Function bundle** (`loadStaffBonusBundle`, `loadStaffProductionBundle`) เป็น fallback จน rules ขึ้น

---

## E. สิ่งที่ควรทำเมื่อ audit เสร็จ

- [ ] สรุปใน 1 ย่อหน้า: มี User Rule ห้ามอะไรบ้าง / ไม่มี
- [ ] ถ้าต้องการ “ป้องกัน AI ลบ rules” แต่ยัง **กู้คืนได้**:
  - เก็บ User Rule แบบ: *ห้าม deploy firestore จาก sibling repo; กู้คืนได้เฉพาะจาก TellTea `firestore.rules` + owner approve*
  - เปิด Firebase Console → Rules → ดู history / publish ด้วยมือเมื่อ API 503
- [ ] Publish rules ชุดที่ต้องการ (full หรือ emergency+staffReadAll) แล้วรัน verify จน `full` หรือ emergency ที่มี marker ครบ
- [ ] ทดสอบ 1 staff + 1 owner หลัง publish

---

## F. อ้างอิงไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
|------|--------|
| `firestore.rules` | ชุดเต็ม (canonical) |
| `firestore.rules.emergency` | fallback สั้น + staff read-all |
| `scripts/verify-firestore-rules-deploy.mjs` | เปรียบ live vs repo |
| `scripts/deploy-firestore-rules-rest.mjs` | deploy ข้าม CLI :test |
| `scripts/assign-staff-full-access.mjs` | ใส่ level `full_access` ให้พนักงาน (Firestore data) |

---

*สร้างจากการ audit 2026-08-28 — อัปเดต checkbox เมื่อทำแต่ละข้อแล้ว*
