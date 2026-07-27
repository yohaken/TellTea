# nPos — รหัสร้าน · เคลมเครื่อง · บล็อกเขียนขาย

อัปเดต: **1.14.27** · `APP_BUILD` 285 · `POS_BUILD` 80 · `versionCode` 50  

เป้าหมายทดลองหน้าร้านจริง: เครื่องที่ไม่มีรหัสร้าน / ยังไม่เคลม **ส่งบิล·เปิดกะ·ปิดกะไม่ได้**  
ตั้งชื่อ/ที่อยู่จากหลังบ้านแล้ว **จำใน Firebase จริง** (ไม่ถูกบิลทับ)

อ้างอิง: `/pos-sales/?tab=manage` · `meta/pos` · `posDevices` · `npos-sell` / `nposClaimDevice`

---

## เช็คลิสต์ยาว

### A — จำชื่อ/ที่อยู่ร้าน
- [x] A1 หลังบ้าน `/pos-sales/?tab=manage` มีตั้งค่าร้าน (embedded owner auth)
- [x] A2 `shopSettingsUpdatedAt` เท่านั้นเป็นนาฬิกาซิงก์หัวบิล — **ไม่**ใช้ `updatedAt` จากบิล
- [x] A3 บันทึก owner → `meta/pos` merge สำเร็จ · nPos อ่านผ่าน `nposShopSettings`
- [x] A4 native ดึง `shopName` / `shopNameTh` / ที่อยู่ / โทร สำหรับใบเสร็จ

### B — รหัสร้านคงที่ (half-login)
- [x] B1 เจ้าของตั้ง/เปลี่ยนรหัสร้านในแท็บจัดการ (เก็บ **hash** ใน `meta/pos` — ไม่ส่งรหัสจริงให้เครื่อง)
- [x] B2 เปิดเกตอัตโนมัติเมื่อมี hash (`storeClaimRequired`)
- [x] B3 เครื่องกรอกรหัสครั้งเดียว → `nposClaimDevice` → `storeClaimed: true`
- [x] B4 หลังบ้านกด **อนุญาต** / **ถอนสิทธิ์** ได้โดยไม่ต้องรู้รหัสบนเครื่อง
- [x] B5 heartbeat บอกเครื่องว่าเคลมแล้วหรือยัง

### C — บล็อกข้อมูลถ้าไม่มีรหัส / ถูกบล็อก / เครื่องพัฒนา
- [x] C1 `assertNposDeviceAllowed` ใช้ร่วมใน `nposSessionOpen` · `Close` · `CompleteSale` · `VoidSale` · `ToggleSoldOut`
- [x] C2 เงื่อนไขเมื่อเกตเปิด: มี doc เครื่อง · ไม่ `blocked` · `storeClaimed` · ไม่ใช่ emulator/`dev` (ปฏิเสธเครื่องจำลองช่วงทดลองร้าน)
- [x] C3 เมนู/ตั้งค่าร้าน **อ่านได้** โดยไม่ต้องเคลม (ให้เห็นจอเคลม)
- [x] C4 Firestore rules ฝั่งเว็บ legacy: ขาย/กะต้องเครื่องที่เคลมแล้ว (ถ้าเกตเปิด)
- [x] C5 native: จอกรอกรหัส · SaleSync หยุด flush เมื่อ 403 `device_not_allowed`

### D — หลังบ้าน / ทดลองจริง
- [x] D1 แผง «รหัสร้าน · เคลมเครื่อง» ใน manage
- [x] D2 การ์ดเครื่องแสดงสถานะเคลม + ปุ่มอนุญาต/ถอน
- [x] D3 บล็อกเครื่องจำลองเก่าจากรายการ (ปุ่มบล็อกที่มีอยู่)
- [x] D4 checklist + gate `test-npos-store-claim.mjs` ใน `check-npos-shop`

### E — คนเทสหน้าร้าน
- [ ] E1 ตั้งรหัสร้านจากมือถือเจ้าของ
- [ ] E2 ลง APK 1.14.27 บนแท็บเล็ตร้าน → กรอกรหัส → ขายได้
- [ ] E3 เครื่องอื่น/เบราว์เซอร์/AVD ส่งบิลไม่เข้า
- [ ] E4 แก้ที่อยู่แล้วรีเฟรช / เปิดแอปใหม่แล้วยังเป็นค่าใหม่

---

## ตรวจ
```bash
node scripts/test-npos-store-claim.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
