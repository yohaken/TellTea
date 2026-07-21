/**
 * Copy built Capacitor debug APK into POS hosting export for public download.
 * Source: android/app/build/outputs/apk/debug/app-debug.apk
 * Dest:   out-pos/downloads/telltea-pos.apk
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src =
  process.env.POS_APK_SRC ||
  path.join(root, "android/app/build/outputs/apk/debug/app-debug.apk");
const destDir = path.join(root, "out-pos/downloads");
const dest = path.join(destDir, "telltea-pos.apk");

if (!fs.existsSync(src)) {
  console.error("FAIL: APK not found at", src);
  console.error("Build first: CAPACITOR_LIVE=0 npx cap sync android && cd android && ./gradlew assembleDebug");
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

const st = fs.statSync(dest);
const capCfgPath = path.join(root, "android/app/src/main/assets/capacitor.config.json");
let embedded = false;
if (fs.existsSync(capCfgPath)) {
  const cfg = fs.readFileSync(capCfgPath, "utf8");
  embedded = !/"url"\s*:/.test(cfg);
}
const meta = {
  file: "telltea-pos.apk",
  bytes: st.size,
  publishedAt: new Date().toISOString(),
  downloadPath: "/downloads/telltea-pos.apk",
  installPage: "/install/",
  embeddedUi: embedded,
  mode: embedded ? "embedded-apk" : "live-webview",
};
fs.writeFileSync(path.join(destDir, "latest.json"), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`OK publish-pos-apk → ${dest} (${st.size} bytes)`);
