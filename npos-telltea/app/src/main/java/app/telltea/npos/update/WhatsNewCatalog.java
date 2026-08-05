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
