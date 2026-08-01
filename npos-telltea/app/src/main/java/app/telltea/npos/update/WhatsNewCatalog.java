package app.telltea.npos.update;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Bundled release notes per {@code versionCode}. Empty list = no card for that build.
 *
 * <p>Text-only by default; pass a drawable id on {@link WhatsNewSlide} when a mock image ships.
 */
public final class WhatsNewCatalog {
  private WhatsNewCatalog() {}

  public static List<WhatsNewSlide> slidesFor(int versionCode) {
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
