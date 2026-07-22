# nPos — deviceClass (shop / dev / blocked)

เป้าหมาย: สาขาเดียว · เครื่องหน้าร้านน้อย · emulator ค้างเป็นเครื่องพัฒนา — ไม่ให้รายการหลังร้านรก

อัปเดต: **nPos 1.11.1 (17)** · `APP_BUILD` 221

## ทำไมหลังร้านดูเหมือนหลายเครื่อง (วิเคราะห์)

สาเหตุหลักตอนเทส **emulator เครื่องเดียว** แต่เห็นหลายแถว/หลายเวอร์ชัน:

1. **Firestore เก็บตาม `installId`** — ทุกครั้งที่ติดตั้ง APK ใหม่ในช่วงแรก (ยังไม่ยึด `ANDROID_ID`) สร้าง doc ใหม่ใน `posDevices` / `nposDiagnose` / `nposOpsLog`
2. **ตรวจเครื่องบน production** เคย list ทุก doc เป็น “เครื่อง” แยก → โผล่ v1.3, v1.4, v1.8… เหมือนหลายเครื่อง
3. **doc เก่าไม่มี `stableKey`** — พับซ้ำไม่ได้จนกว่าจะกู้จาก `installId` รูป `npos`+ANDROID_ID
4. **UUID orphan** จาก wipe ช่วงแรก — ผูกกลับเครื่องเดิมไม่ได้ ต้องซ่อนเมื่อมีเครื่องที่มี stableKey แล้ว

แก้ (1.11.1): กู้ `stableKey` จาก installId · พับเหลือรายงานล่าสุดต่อเครื่อง · ซ่อน orphan/ออฟเมื่อมีเครื่องออน · hint บอกจำนวนที่ซ่อน

---

## เช็คลิสต์ลงมือ

### 1) ส่งแฟล็กจากแอป
- [x] `stableKey` (ANDROID_ID) บน heartbeat / ops / diagnose
- [x] `isEmulator` heuristic (AVD / Genymotion / sdk)
- [x] `deviceClass` ค่าเริ่มต้น: emulator → `dev` · เครื่องจริง → `shop`
- [x] แอปไม่ส่ง `blocked` เอง

### 2) Cloud Functions เก็บ + เคารพบล็อก
- [x] `nposDeviceHeartbeat` เขียน `stableKey` · `isEmulator` · `deviceClass`
- [x] heartbeat **ไม่ปลด** `deviceClass=blocked` / `blocked=true`
- [x] sibling เดิมที่ `stableKey` เดียวกันยังมาร์ก `disabled` (ghost)
- [x] `reportNposOpsLog` / `reportNposDiagnose` เก็บแฟล็กเดียวกัน

### 3) หลังร้านพับ + กลุ่ม + ปุ่มบล็อก
- [x] แผงเครื่อง: พับ **เครื่องหน้าร้าน / เครื่องพัฒนา / บล็อก**
- [x] dedupe ตาม `stableKey` (ซ่อน ghost reinstall)
- [x] ปุ่ม **บล็อก** / **ปลดบล็อก** (`setNposDeviceBlocked`)
- [x] ไทม์ไลน์ ops + diagnose พับตามคลาส · คอลัมน์เครื่องใช้ `stableKey`

### นอกขอบเขต (ตั้งใจไม่ทำรอบนี้)
- [ ] multi-branch / หลายร้าน
- [ ] workflow claim เครื่องหนัก
- [ ] collection `posMachines` แยก
- [ ] ล็อกไฟล์บนเครื่อง

## ตรวจ (สคริปต์)

```bash
node scripts/test-npos-device-class.mjs
```

## ตรวจมือหลัง deploy CF + APK

| # | ขั้นตอน | ผ่านเมื่อ |
|---|---------|-----------|
| 1 | เปิด emulator → heartbeat | หลังร้านอยู่กลุ่ม **เครื่องพัฒนา** |
| 2 | เปิดแท็บเล็ตจริง → heartbeat | อยู่กลุ่ม **เครื่องหน้าร้าน** |
| 3 | กดบล็อกเครื่องหลุด | ย้ายไป **บล็อก** · heartbeat รอบถัดไปยังบล็อกอยู่ |
| 4 | ปลดบล็อก | กลับ shop/dev ตาม `isEmulator` |
| 5 | wipe/reinstall emulator เดิม | ไม่โผล่เป็นหลายเครื่อง (stableKey เดิม) |
| 6 | ops log / diagnose | พับคลาสเดียวกัน · คอลัมน์เครื่องสั้นจาก stableKey |
