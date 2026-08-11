package app.telltea.npos.update;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Bundled release notes per {@code versionCode}. Empty list = no card for that build.
 *
 * <p><b>Ship rule:</b> every APK {@code versionCode} bump MUST add non-empty slides here.
 * CI {@code scripts/test-npos-whats-new.mjs} fails if the current gradle versionCode has none.
 *
 * <p>Text-only by default; pass a drawable id on {@link WhatsNewSlide} when a mock image ships.
 */
public final class WhatsNewCatalog {
  private WhatsNewCatalog() {}

  public static List<WhatsNewSlide> slidesFor(int versionCode) {
    if (versionCode == 151) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "ปุ่มพิมพ์ให้แต้มชัดขึ้น",
              "แถบส้มเต็มความกว้างเหนือชำระเงิน · ไม่ต้องมีบิลในตะกร้า · โชว์คงเหลือ"));
      return slides;
    }
    if (versionCode == 150) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "ปุ่มให้แต้มบนจอขาย",
              "พิมพ์ QR ของขวัญ 1 แต้ม · ลูกค้าสแกนรับ · มีโควต้าต่อวันจากหลังร้าน"));
      return slides;
    }
    if (versionCode == 149) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "ส่งภาพสลิปกลับหลังร้าน",
              "พิมพ์บิลแล้วรูปสลิปจริงโผล่ที่แผงเครื่องหลังร้าน · ไม่ต้องถามพนักงาน"));
      return slides;
    }
    if (versionCode == 148) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "โลโก้ร้านบนใบเสร็จ",
              "พิมพ์โลโก้จากหลังร้านบนหัวสลิป · เปลี่ยนรูปไม่ต้องอัป APK ใหม่"));
      return slides;
    }
    if (versionCode == 147) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สลิปโชว์แต้มบิลนี้",
              "แถวยอดสุทธิ: แต้มบิลนี้ +X · ใต้ QR ยังเป็นชวนสแกนสั้นๆ"));
      return slides;
    }
    if (versionCode == 146) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สลิปบอกวิธีใช้แต้ม",
              "ใต้ QR: 1แต้ม=ลด1฿ · ครั้งหน้าบอกเบอร์ตอนจ่าย"));
      return slides;
    }
    if (versionCode == 145) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สลิปเต็มความกว้างกระดาษจริง",
              "พิมพ์เป็นภาพเต็มแผ่น 80mm · ราคาชิดขอบ · ไม่กระทบ LINE MAN"));
      return slides;
    }
    if (versionCode == 144) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "ใช้ปริ้นร่วมกับ LINE MAN ได้",
              "หลังพิมพ์บิล nPos ปล่อยเครื่องพิมพ์ทันที · แอปอื่นพิมพ์ต่อได้"));
      return slides;
    }
    if (versionCode == 143) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สลิปเต็มความกว้างกระดาษ",
              "ราคาชิดขวา · เส้นคั่นยาว · QR ใหญ่ขึ้นบน Sunmi D2s"));
      return slides;
    }
    if (versionCode == 142) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สลิป QR กับข้อความไม่ซ้อนกัน",
              "สแกนสะสมแต้มอยู่ใต้ QR · ไม่เยื้องข้าง · ช่องว่างใหญ่หาย"));
      return slides;
    }
    if (versionCode == 141) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "ปุ่มสมาชิกข้างชำระเงิน",
              "สมาชิกอยู่ขวาของปุ่มชำระทั้งหมด · ใช้แต้มยังอยู่แถบตะกร้า"));
      slides.add(
          new WhatsNewSlide(
              "สลิป QR เล็กลง · ข้อความชัดขึ้น",
              "QR สะสมแต้มย่อลง · คำว่าสแกนสะสมแต้มตัวหนาใหญ่ขึ้น"));
      return slides;
    }
    if (versionCode == 140) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "คอนเฟิร์มแต้มหลังใส่เบอร์",
              "ค้นหาสมาชิกแล้วโชว์คงเหลือ · บอกลูกค้าก่อน · เลือกใช้แต้มหรือไม่ใช้"));
      slides.add(
          new WhatsNewSlide(
              "ใช้ทั้งหมดหรือบางส่วน",
              "กดใช้แต้มแล้วเลือกจำนวน · ใช้สูงสุดทั้งบิล หรือคีย์บางส่วน"));
      return slides;
    }
    if (versionCode == 139) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สลิปแสดงสมาชิกและแลกแต้ม",
              "ใบเสร็จแยกส่วนลดมือ · แลกแต้ม · ชื่อและเบอร์สมาชิกเมื่อติดบิล"));
      slides.add(
          new WhatsNewSlide(
              "QR สะสมแต้มท้ายสลิป",
              "เมื่อเปิดทดลอง QR สลิปหลังร้าน เครื่องพิมพ์ QR ทุกใบ (รวมยอด 0) · สแกนสะสมแต้ม"));
      return slides;
    }
    if (versionCode == 138) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "สมาชิกและใช้แต้มบนจอขาย",
              "ใส่เบอร์สมาชิก · ใช้แต้มก่อนคิดเงินสด/โอน · แลกครบยอดปิดบิลได้โดยไม่รับเงิน"));
      slides.add(
          new WhatsNewSlide(
              "พักบิลพกสมาชิก",
              "พักบิลแล้วดึงกลับยังมีสมาชิกเดิม · แต้มรีเฟรชใหม่ · จำนวนแต้มที่เคยเลือกไม่ค้าง"));
      return slides;
    }
    if (versionCode == 137) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "เงินไม่ตรงต้องใส่เหตุผล",
              "ปิดรอบแล้วเงินขาดหรือเกิน ต้องระบุเหตุผลก่อนยืนยัน — หลังร้านเห็นเหตุผลนั้นด้วย"));
      return slides;
    }
    if (versionCode == 136) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "เลือกชื่อจากระบบเท่านั้น",
              "เปิดรอบต้องแตะชื่อพนักงานที่มีในหลังบ้าน — พิมพ์ชื่อเองไม่ได้แล้ว"));
      return slides;
    }
    if (versionCode == 135) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "ลงชื่อผู้เริ่มรอบหลังปิดกะ",
              "ปิดรอบแล้วต้องแตะชื่อผู้เริ่มรอบถัดไปเอง — ไม่จำชื่ออัตโนมัติ และไม่ใช่รหัสปลดล็อกเครื่อง"));
      slides.add(
          new WhatsNewSlide(
              "แก้ไขยอดนับสต็อกได้",
              "แตะช่องที่นับแล้วเพื่อแก้จำนวนโดยไม่ต้องลบทั้งรอบนับ"));
      slides.add(
          new WhatsNewSlide(
              "เมนูขายสั้นลง",
              "จัดกลุ่ม รอบการขาย · เมนู · ตั้งค่า — เปิดลิ้นชักและใบเสร็จอยู่ด้านบน"));
      slides.add(
          new WhatsNewSlide(
              "เงินทอนเริ่มรอบคีย์ใหม่ได้",
              "ทุกครั้งที่เปิดรอบ กรอกเงินทอนเริ่มได้ใหม่ (ดึงยอดค้างจากรอบก่อนเป็นค่าเริ่ม)"));
      return slides;
    }
    if (versionCode == 130) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "จ่ายสดเร็วขึ้น",
              "ลิ้นชักเปิดทันทีตอนคิดเงินสด ขณะที่ใบเสร็จพิมพ์ตาม — ไม่ต้องรอตัดกระดาษ"));
      slides.add(
          new WhatsNewSlide(
              "คีย์บิลถัดไปไม่ติดเน็ต",
              "บันทึกในเครื่องกับพิมพ์ทำก่อน ซิงก์หลังบ้านทำงานพื้นหลัง"));
      return slides;
    }
    if (versionCode == 128) {
      List<WhatsNewSlide> slides = new ArrayList<>();
      slides.add(
          new WhatsNewSlide(
              "จัดการเมนูในแถบเมนู",
              "เปิดจากแถบซ้ายหรือเมนูหัวข้อหน้าขาย — แก้ราคา ของหมด และรายการบนเครื่องได้"));
      slides.add(
          new WhatsNewSlide(
              "กดค้างเมนูในกริดขาย",
              "ตั้งของหมดหรือกดแก้ไขเมนูเพื่อเปิดรายการนั้นโดยตรง"));
      return slides;
    }
    return Collections.emptyList();
  }
}
