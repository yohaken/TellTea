# nPos — แคปจอจริง (MediaProjection) + สิทธิ์แคปแยก

อัปเดต: **1.14.105** · `versionCode` 125 · `APP_BUILD` 544 · `POS_BUILD` 156

## รากปัญหาที่ทำให้「ไม่เคยแคปได้」(เครื่อง 12570f0f)

1. **VirtualDisplay poll บล็อก Handler ตัวเดียวกับ ImageReader** → callback เฟรมไม่ทันวิ่ง → `no_usable_frame` ตลอด  
2. เครื่องนี้ **API &lt; 26** → PixelCopy ใช้ไม่ได้ แต่โค้ดเก่าคืน `api_lt_26` ทันที **ไม่ลอง `View.draw`**  
3. ผลรวม: MediaProjection “live” แต่ไม่มีรูป · fallback ก็ตาย → ops แดงซ้ำ

## แก้ใน 1.14.102

| หัวข้อ | ทำอย่างไร |
|--------|----------|
| VirtualDisplay | poll `acquireLatestImage()` บน **thread แยก** · ไม่ starve listener |
| เฟรมดำ | รอ settle · reject ดำ · ลองครึ่งขนาดถ้าเต็มจอล้ม |
| API &lt; 26 | primary/secondary ใช้ **`View.draw` / draw_decor** เป็น fallback (ไม่คืน `api_lt_26`) |
| API ≥ 26 | PixelCopy ก่อน แล้วค่อย draw |
| Ack เมื่อมีรูป | `hasImages` เท่านั้น — ว่างแล้ว heartbeat ลองใหม่ |

## คนเทสเคาน์เตอร์
1. อัปเป็น **1.14.102** → อนุญาตแชร์หน้าจอ  
2. หลังร้าน「สั่งแคปจอ」→ ต้องมีรูปจอขาย (และจอลูกค้าถ้ามี)  
3. ops ไม่ควรเหลือ `api_lt_26` / `no_usable_frame` ติดกันเป็นแถว

```bash
node scripts/test-npos-capture-projection.mjs
node scripts/test-npos-capture.mjs
```
