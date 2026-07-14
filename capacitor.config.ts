import type { CapacitorConfig } from "@capacitor/cli";

/**
 * TellTea POS — Android native shell (Capacitor).
 *
 * ช่วงพัฒนา: โหลดเว็บสดจาก Hosting (`server.url`) → แก้โค้ดเว็บแล้วแท็บเล็ตได้ของใหม่หลังรีโหลด WebView
 * โปรดักชันนิ่ง: ปิด server.url แล้ว `npm run build && npx cap sync` ให้ส่ง static ใน APK
 */
const LIVE_POS_URL = process.env.CAPACITOR_POS_URL || "https://telltea-pos.web.app/pos/";

const useLiveServer = process.env.CAPACITOR_EMBED !== "1";

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
    : {}),
};

export default config;
