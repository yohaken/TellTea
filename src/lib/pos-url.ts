/** URL ติดตั้งแท็บเล็ต POS — โดเมนแยกจากหลังร้าน TellTea */
export const POS_ENTRY_URL = "https://telltea-pos.web.app/pos/";

/** หน้าดาวน์โหลด APK (เปิดบน Chrome แท็บเล็ตได้เลย) */
export const POS_APK_INSTALL_PAGE_URL = "https://telltea-pos.web.app/install/";

/** ลิงก์ไฟล์ .apk โดยตรง — ใช้ในตั้งค่าปล่อยอัปเดตด้วย */
export const POS_APK_DOWNLOAD_URL = "https://telltea-pos.web.app/downloads/telltea-pos.apk";

/** POS app path on standalone hosting (Next.js route). */
export function posEntryPath(): string {
  return "/pos/";
}
