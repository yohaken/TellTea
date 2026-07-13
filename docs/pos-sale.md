# POS บันทึกการขาย — สาเหตุที่เป็นไปได้ (ระยะยาว)

> อัปเดต 2026-07-13 · อ้างอิงเมื่อขายหน้าร้าน error

## เส้นทางปัจจุบัน (v128+)

```
แท็บเล็ต POS
  → signIn posDeviceAuth (custom token + claim posDevice)
  → httpsCallable posCompleteSale (asia-southeast1)
  → Admin SDK transaction:
       อ่าน meta/pos + meta/ledger
       เขียน posSales + ledger + meta/ledger + เลขบิล
  → อัปเดต posSessions (ยอดกะ)
```

**ไม่พึ่ง Firestore rules ฝั่ง client** สำหรับบันทึกบิล — ลดปัญหา permission-denied จาก rules/increment/merge

---

## สาเหตุที่เป็นไปได้ (เรียงความน่าจะเป็น)

### 1. Cloud Function / Transaction (เซิร์ฟเวอร์)

| สาเหตุ | อาการ | ป้องกัน |
|--------|-------|---------|
| **อ่านหลังเขียนใน transaction** | `บันทึกการขายไม่สำเร็จ` (internal) | อ่าน `meta/pos` + `meta/ledger` ก่อน `tx.set` ทั้งหมด · CI `test:pos-complete-sale` |
| Function ยังไม่ deploy | internal / not found | รอ GitHub Actions step Functions · ดู build บน POS |
| Cold start / timeout | ช้าแล้ว error | ภูมิภาค `asia-southeast1` ใกล้ไทย |
| Admin SDK กับ Firestore index | failed-precondition | ดู Cloud Logging |

### 2. ตัวตนเครื่อง POS

| สาเหตุ | อาการ | ป้องกัน |
|--------|-------|---------|
| ไม่มี claim `posDevice` | ไม่ใช่เครื่อง POS | ใช้ `posDeviceAuth` เป็นหลัก · รีเฟรชหน้า |
| UID กับ `deviceId` ไม่ตรง | invalid-argument | client ส่ง `auth.uid` เสมอ |
| Anonymous ปิด + CF ล้ม | เข้า POS ไม่ได้ | workflow `enable-anonymous-auth` (fallback) |

### 3. ข้อมูลการขาย

| สาเหตุ | อาการ | ป้องกัน |
|--------|-------|---------|
| เงินรับ < ยอด | เงินไม่พอ (client) | ปุ่มยืนยัน disabled จนกว่ารับพอ |
| ตะกร้าว่าง / บรรทัดเมนูเสีย | ตะกร้าว่าง | validate ทั้ง client + function |
| `sessionId` ไม่ตรงกะที่เปิด | บิลได้แต่ยอดกะไม่ขยับ | เปิดกะใหม่หลัง reload |

### 4. เวลา / เลขบิล

| สาเหตุ | อาการ | ป้องกัน |
|--------|-------|---------|
| วันรายการ (client) vs วันเลขบิล (server Bangkok) | บิลข้ามวันใกล้เที่ยงคืน | ใช้ Asia/Bangkok ฝั่ง server · แท็บเล็ตตั้งโซนไทย |
| เลขบิลชนกัน (หลายเครื่อง) | transaction retry | counter อยู่ใน transaction เดียวกับบิล |

### 5. Deploy / เวอร์ชันเก่า

| สาเหตุ | อาการ | ป้องกัน |
|--------|-------|---------|
| JS เก่า (v116–126) เขียน Firestore ตรง | สิทธิ์ไม่พอ | `PosUpdateWatcher` + owner บังคับอัปเดต |
| Rules เก่าไม่ deploy | permission-denied | deploy `firestore` ใน CI ทุก push |
| Hosting ใหม่แต่ Functions เก่า | internal / พฤติกรรมแปลก | deploy คู่กันใน workflow เดียว |

### 6. เครือข่าย / อุปกรณ์

| สาเหตุ | อาการ | ป้องกัน |
|--------|-------|---------|
| Wi‑Fi หลุดตอนกดยืนยัน | เชื่อมต่อไม่ได้ | ป้าย เน็ตออฟ · ลองใหม่ |
| แท็บเล็ต RAM ต่ำ | ช้า / crash | PWA standalone · ปิดแท็บอื่น |

---

## ข้อความ error → แปลความ

| ข้อความ | น่าจะเป็น |
|---------|-----------|
| สิทธิ์ไม่พอ | Firestore rules (โค้ดเก่า) หรือ token ไม่ใช่ POS |
| ไม่ใช่เครื่อง POS | callable ไม่เห็น claim `posDevice` |
| เงินที่รับน้อยกว่ายอด | ไม่ได้ใส่เงินรับพอ |
| บันทึกการขายไม่สำเร็จ | CF internal — ดู Cloud Logging `posCompleteSale` |
| เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ | เน็ต / function cold start |

---

## ตรวจเมื่อมีปัญหา

1. ดู build มุมขวาบน POS — ต้องตรงกับ `main` ล่าสุด
2. Firebase Console → Functions → Logs → `posCompleteSale`
3. ลองขาย 1 รายการ เงินสด รับเท่ายอดพอดี
4. เจ้าของดู Settings → ยอดขาย POS วันนี้ ว่ามีบิลเข้าหรือไม่

---

## งานป้องกันระยะยาว (แนะนำ)

- [x] ย้ายบันทึกบิลไป `posCompleteSale` (Admin SDK)
- [x] CI ตรวจลำดับ read/write ใน transaction
- [ ] Emulator test บันทึกบิล end-to-end
- [ ] แจ้งเตือน owner เมื่อ POS sale fail ซ้ำ (อนาคต)
