# nPos — ตรวจปล่อยอัปเดตขึ้นเว็บจริง

อัปเดตตรวจ: **2026-07-31** · เป้าหมาย **1.14.100 (123)**

## เช็คลิสต์ปล่อย (ทำจนครบ)

- [x] CI Deploy TellTea สำเร็จ (APK compile + publish)
- [x] `https://telltea-pos.web.app/downloads/latest.json` → `versionCode` **123** · `versionName` **1.14.100**
- [x] `https://telltea-pos.web.app/downloads/nPos-telltea.apk` ตอบ HTTP 200
- [ ] เครื่องหน้าร้านเวอร์ชันเก่ากว่า 123 → เด้งป๊อปบังคับอัปเดตทันที (+เสียง) — ไม่รอตะกร้าว่าง
- [ ] ถ้ายังไม่มีสิทธิ์ติดตั้ง → เปิดหน้าตั้งค่า → อนุญาตแล้วอัปต่อ

## คำสั่งตรวจเร็ว

```bash
curl -sS "https://telltea-pos.web.app/downloads/latest.json"
```

## โน้ตเหตุการณ์
- 1.14.97 พัง compile → `latest.json` ค้างที่ 1.14.96
- 1.14.98–99 ขึ้นเว็บแล้ว · idle-gate ถอดใน **1.14.100**
