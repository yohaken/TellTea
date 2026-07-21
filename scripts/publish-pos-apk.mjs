/**
 * Copy nPos-telltea Hello World APK into POS hosting export for public download.
 * Source: npos-telltea/app/build/outputs/apk/debug/app-debug.apk
 * Dest:   out-pos/downloads/nPos-telltea.apk
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src =
  process.env.POS_APK_SRC ||
  path.join(root, "npos-telltea/app/build/outputs/apk/debug/app-debug.apk");
const destDir = path.join(root, "out-pos/downloads");
const dest = path.join(destDir, "nPos-telltea.apk");

if (!fs.existsSync(src)) {
  console.error("FAIL: APK not found at", src);
  console.error("Build first: cd npos-telltea && ./gradlew assembleDebug");
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

const st = fs.statSync(dest);
const meta = {
  file: "nPos-telltea.apk",
  product: "nPos-telltea",
  bytes: st.size,
  publishedAt: new Date().toISOString(),
  downloadPath: "/downloads/nPos-telltea.apk",
  installPage: "/install/",
  mode: "hello-world",
};
fs.writeFileSync(path.join(destDir, "latest.json"), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`OK publish-pos-apk → ${dest} (${st.size} bytes)`);
