import type { CapacitorConfig } from "@capacitor/cli";

/**
 * TellTea POS — Android shell (Capacitor).
 *
 * ดีฟอลต์ (โปรดักชัน / ลิงก์ดาวน์โหลด): ฝัง static ใน APK — ไม่โหลด UI จาก Hosting
 * พัฒนาชั่วคราวเท่านั้น: CAPACITOR_LIVE=1 เพื่อชี้ server.url ไปเว็บสด
 */
const LIVE_POS_URL = process.env.CAPACITOR_POS_URL || "https://telltea-pos.web.app/pos/";

/** ฝังใน APK เป็นค่าเริ่มต้น — ตั้ง CAPACITOR_LIVE=1 เท่านั้นถ้าต้องการโหลดเว็บสด */
const useLiveServer = process.env.CAPACITOR_LIVE === "1";

const config: CapacitorConfig = {
  appId: "app.telltea.pos",
  appName: "TellTea POS",
  webDir: "out-pos/pos",
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f1419",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#0f1419",
    },
  },
  ...(useLiveServer
    ? {
        server: {
          url: LIVE_POS_URL,
          cleartext: false,
          allowNavigation: [
            "telltea-pos.web.app",
            "telltea-shop.web.app",
            "*.web.app",
            "*.googleapis.com",
            "*.firebaseio.com",
            "*.cloudfunctions.net",
            "firestore.googleapis.com",
            "identitytoolkit.googleapis.com",
            "securetoken.googleapis.com",
          ],
        },
      }
    : {
        // ยังอนุญาตเรียก Firebase API จาก WebView ที่ฝังใน APK
        server: {
          cleartext: false,
          allowNavigation: [
            "telltea-pos.web.app",
            "telltea-shop.web.app",
            "*.web.app",
            "*.googleapis.com",
            "*.firebaseio.com",
            "*.cloudfunctions.net",
            "firestore.googleapis.com",
            "identitytoolkit.googleapis.com",
            "securetoken.googleapis.com",
          ],
        },
      }),
};

export default config;
