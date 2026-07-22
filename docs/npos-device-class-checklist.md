# nPos — deviceClass (shop / dev / blocked)

เป้าหมาย: สาขาเดียว · **1 เครื่องจริง = 1 การ์ด** ยึด `stableKey` (ANDROID_ID) · emulator = พัฒนา

อัปเดต: **nPos 1.14.6 (29)** · `APP_BUILD` 236

## ทำไมหลังร้านดูเหมือนหลายเครื่อง (วิเคราะห์)

สาเหตุหลักตอนเทส **emulator เครื่องเดียว** แต่เห็นหลายแถว/หลายเวอร์ชัน:

1. **Firestore เก็บตาม `installId`** — ติดตั้ง APK ใหม่ช่วงแรกสร้าง doc ใหม่
2. **ตรวจเครื่อง** เคย list ทุก doc เป็น “เครื่อง” แยก
3. **doc เก่าไม่มี `stableKey`** — พับไม่ได้จนกว่ากู้จาก `npos`+ANDROID_ID
4. **UUID orphan** จาก wipe — ซ่อนเมื่อมีเครื่องที่มี stableKey แล้ว
5. **Heartbeat หยุดตอนเข้าหน้าขาย** → BO ขึ้นออฟทั้งที่เปิดอยู่ (แก้ 1.14.6)

แก้ล่าสุด (1.14.6):
- ตรวจเครื่องพับตาม `stableKey` + จับคู่เครื่องที่ยัง live ใน `posDevices`
- heartbeat ทำเครื่อง sibling เป็น `disabled` ทั้ง `posDevices` และ `nposDiagnose`
- `ForegroundHeartbeat` ส่งสัญญาณทุก ~50s ขณะแอปอยู่ foreground (รวมหน้าขาย)
- หน้าต่างออนไลน์ BO = 5 นาที

---

## เช็คลิสต์ลงมือ

### 1) ส่งแฟล็กจากแอป
- [x] `stableKey` (ANDROID_ID) บน heartbeat / ops / diagnose
- [x] `isEmulator` · `deviceClass` (emulator → dev)
- [x] `ForegroundHeartbeat` ตลอด foreground

### 2) Cloud Functions
- [x] heartbeat เขียน `stableKey` · ไม่ปลด blocked
- [x] sibling เดิม → `disabled` + diagnose `supersededBy`

### 3) หลังร้าน
- [x] แผงเครื่อง / ตรวจเครื่อง พับตาม stableKey
- [x] ตรวจเครื่องโชว์ออน/ออฟตาม heartbeat จริง
- [x] ปุ่มบล็อก / ปลดบล็อก

### Local-first (L1 · คู่ขนาน)
- [x] อุ่นแคชเมนูตอนเปิดแอป (`MenuWarmup`)
- [x] หน้าขาย paint จากแคชก่อน · ซิงก์พื้นหลัง timeout สั้น
- [ ] Room/SQLite แทน SharedPreferences เมื่อคิวโต (ยังไม่จำเป็น)

## ตรวจ

```bash
node scripts/test-npos-device-class.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```

## มือหลัง deploy APK 1.14.6

| # | ผ่านเมื่อ |
|---|-----------|
| 1 | เปิด emu → เข้าหน้าขายค้างไว้ ≥3 นาที → หลังร้านยัง **ออน** |
| 2 | ตรวจเครื่อง / เครื่อง nPos เห็น **1 การ์ด** ต่อ emu |
| 3 | เปิดขายครั้งถัดไปเมนูขึ้นจากแคชเร็ว (ไม่รอเครือข่ายก่อน) |
