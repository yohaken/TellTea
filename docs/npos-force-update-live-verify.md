# nPos — ตรวจปล่อยอัปเดตขึ้นเว็บจริง

อัปเดตตรวจ: **2026-07-31** · เป้าหมาย **1.14.98 (121)**

## เช็คลิสต์ปล่อย (ทำจนครบ)

- [x] CI Deploy TellTea สำเร็จ (APK compile + publish)
- [x] `https://telltea-pos.web.app/downloads/latest.json` → `versionCode` **121** · `versionName` **1.14.98**
- [x] `https://telltea-pos.web.app/downloads/nPos-telltea.apk` ตอบ HTTP 200
- [ ] เครื่องหน้าร้านเวอร์ชันเก่ากว่า 121 · **ตะกร้าว่าง** → เด้งป๊อปบังคับอัปเดต (+เสียง)
- [ ] ตะกร้ามีของ → ไม่เด้งจนกว่าจะว่าง
- [ ] ถ้ายังไม่มีสิทธิ์ติดตั้ง → เปิดหน้าตั้งค่า → อนุญาตแล้วอัปต่อ

## คำสั่งตรวจเร็ว

```bash
curl -sS "https://telltea-pos.web.app/downloads/latest.json"
```

## โน้ตเหตุการณ์
- 1.14.97 พัง compile → `latest.json` ค้างที่ 1.14.96
- แก้แล้วปล่อย **1.14.98** · ขึ้นเว็บจริงแล้ว
