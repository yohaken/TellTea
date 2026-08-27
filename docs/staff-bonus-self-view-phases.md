# Staff bonus / production self-view — fix phases

ปัญหาที่พบจากพนักงาน (เช่น เตย): ขึ้น «สิทธิ์ไม่พอ» ทั้งที่เห็นยอดบางส่วน · ประวัติผลิตไม่ครบ · โบนัสสลับ ~900 / ~1,062

## Phase 1 — Rules (deploy ก่อน) ✅

- [x] `bonusPersonalCloses/{id}` — เดือนเปิดยังไม่มี doc → `resource == null` ทำให้ `resource.data.employeeId` ล้ม
- [x] เพิ่ม `personalCloseEmployeeId` + `canReadBonusPersonalClose` อ่านจาก path id เมื่อ doc ว่าง
- [x] `linkedLevelActive` + `staffHasBrokenLevelLink` — คู่ client resolveEffectivePermissions
- [ ] **Deploy:** `firebase deploy --only firestore:rules` (โปรเจกต์ mypeer-501909)
- [ ] **Verify:** `npm run verify:firestore-rules` (live markers)

## Phase 2 — Client ฝั่งพนักงาน (ทุกคนใน roster) ✅

- [x] รอ `authStatus === "ready"` ก่อน subscribe (โบนัส · ผลิต)
- [x] retry subscribe ตารางเรท + personal close (เหมือน bonusLivePool)
- [x] ไม่โชว์ error แดง «สรุปโบนัส» เมื่อ personal close ว่าง/permission เก่า
- [x] หน้าผลิต: แปล error เป็นภาษาไทย (`mapFirestoreError`)
- [x] `workEntryIncludesMe` — fallback `createdBy === staff.id` สำหรับแถวที่ตัวเองกรอก

## Phase 3 — ข้อมูล / ลิงก์ roster (ทั้ง roster ไม่ใช่คนเดียว)

- [ ] รัน audit ทั้งร้าน: `OUT_DIR=artifacts node scripts/audit-staff-bonus-access.mjs`
- [ ] แก้อัตโนมัติที่ปลอดภัย: `APPLY=1 node scripts/audit-staff-bonus-access.mjs`
- [ ] แก้คนแดงที่เหลือ: ผูก `staff.employeeId` ↔ `employees.linkedStaffId` ในศูนย์พนักงาน
- [ ] ถ้าเปลี่ยนชื่อในร้าน: ใส่ `previousNames` บน roster ให้แถวเก่าจับคนเดิมได้

## Phase 4 — ตรวจหลัง deploy

- [ ] พนักงานเปิด **จ่าย/โบนัส** — ไม่มีแถบแดง «สิทธิ์ไม่พอ»
- [ ] เปิด **ผลิต** เดือนส.ค. — เห็นแถว ~17–18 ถ้ามีในระบบ (ชื่อ/id ตรง หรือ createdBy ตรง)
- [ ] เจ้าของพรีวิวมุมพนักงาน → ยอดตรงกับที่พนักงานเห็น
- [ ] `npm run test:firestore-rules && npm run test:bonus-staff-mine`

## สาเหตุยอดสลับ (~900)

| ส่วน | เมื่อหาย |
|------|----------|
| ขายเบเกอรี่ (~300) | `bonusLivePool` ยังไม่อัปเดต / subscribe ล้มช่วง auth ยังไม่พร้อม |
| ผลิต / ชง | กรองชื่อ-id ไม่ตรง · แถวเก่าไม่มี workerIds |
| แถบ error | personal close get บน doc ว่าง (แก้ Phase 1) |

Cloud Function `bonus-live-pool-sync` อัปเดตพูลอัตโนมัติเมื่อมีชง/ผลิต — หลัง rules deploy ยอดควรนิ่งขึ้น
