/**
 * Copy nPos-telltea APK into POS hosting export + write versioned latest.json.
 * Source: npos-telltea/app/build/outputs/apk/debug/app-debug.apk
 * Dest:   out-pos/downloads/nPos-telltea.apk
 * Meta:   out-pos/downloads/latest.json  (apps poll this for updates)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src =
  process.env.POS_APK_SRC ||
  path.join(root, "npos-telltea/app/build/outputs/apk/debug/app-debug.apk");
const destDir = path.join(root, "out-pos/downloads");
const dest = path.join(destDir, "nPos-telltea.apk");
const publicApkUrl = "https://telltea-pos.web.app/downloads/nPos-telltea.apk";
const publicManifestUrl = "https://telltea-pos.web.app/downloads/latest.json";

if (!fs.existsSync(src)) {
  console.error("FAIL: APK not found at", src);
  console.error("Build first: cd npos-telltea && ./gradlew assembleDebug");
  process.exit(1);
}

function readVersionFromBuildGradle() {
  const gradle = fs.readFileSync(
    path.join(root, "npos-telltea/app/build.gradle"),
    "utf8",
  );
  const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
  const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "0";
  return { versionCode: code, versionName: name };
}

function readVersionFromApk(apkPath) {
  const aaptCandidates = [
    process.env.AAPT_PATH,
    path.join(process.env.ANDROID_HOME || "", "build-tools/35.0.0/aapt"),
    path.join(process.env.ANDROID_HOME || "", "build-tools/34.0.0/aapt"),
    "/usr/local/lib/android/sdk/build-tools/35.0.0/aapt",
  ].filter(Boolean);

  for (const aapt of aaptCandidates) {
    if (!fs.existsSync(aapt)) continue;
    try {
      const out = execFileSync(aapt, ["dump", "badging", apkPath], {
        encoding: "utf8",
      });
      const code = Number((out.match(/versionCode='(\d+)'/) || [])[1] || 0);
      const name = (out.match(/versionName='([^']+)'/) || [])[1] || "";
      if (code > 0 && name) return { versionCode: code, versionName: name };
    } catch {
      /* try next */
    }
  }
  return null;
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

const st = fs.statSync(dest);
const fromApk = readVersionFromApk(src);
const fromGradle = readVersionFromBuildGradle();
const versionCode = fromApk?.versionCode || fromGradle.versionCode;
const versionName = fromApk?.versionName || fromGradle.versionName;

if (!versionCode || !versionName) {
  console.error("FAIL: could not resolve versionCode/versionName");
  process.exit(1);
}

const notes =
  process.env.POS_APK_NOTES?.trim() ||
  `nPos-telltea ${versionName} (${versionCode})`;

const meta = {
  product: "nPos-telltea",
  versionCode,
  versionName,
  file: "nPos-telltea.apk",
  bytes: st.size,
  publishedAt: new Date().toISOString(),
  downloadPath: "/downloads/nPos-telltea.apk",
  apkUrl: publicApkUrl,
  manifestUrl: publicManifestUrl,
  installPage: "/install/",
  notes,
  mode: "native-apk",
};

fs.writeFileSync(path.join(destDir, "latest.json"), `${JSON.stringify(meta, null, 2)}\n`);

console.log(
  `OK publish-pos-apk → ${dest} (${st.size} bytes) v${versionName} (${versionCode})`,
);
console.log(`OK manifest → ${publicManifestUrl}`);
