# nPos — ตรวจปล่อยอัปเดตขึ้นเว็บจริง

อัปเดตตรวจ: **2026-07-31** · เป้าหมาย **1.14.101 (124)**

## เช็คลิสต์ปล่อย (ทำจนครบ)

- [ ] CI Deploy TellTea สำเร็จ (APK compile + publish)
- [ ] `https://telltea-pos.web.app/downloads/latest.json` → `versionCode` **124** · `versionName` **1.14.101**
- [ ] `https://telltea-pos.web.app/downloads/nPos-telltea.apk` ตอบ HTTP 200
- [ ] เครื่องหน้าร้านเวอร์ชันเก่ากว่า 124 → ป๊อป**กลางจอ** · ปุ่มเดียว「อัปเดต」· บังหน้าจอด้านหลัง
- [ ] ถ้ายังไม่มีสิทธิ์ติดตั้ง → เปิดหน้าตั้งค่า → อนุญาตแล้วอัปต่อ

## คำสั่งตรวจเร็ว

```bash
curl -sS "https://telltea-pos.web.app/downloads/latest.json"
```

## โน้ตเหตุการณ์
- 1.14.100 บังคับอัปไม่รอตะกร้า · UI กลางจอใน **1.14.101**
