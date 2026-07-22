/**
 * nPos-telltea — install page + APK update channel wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-url.ts"), /POS_APK_INSTALL_PAGE_URL/);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/downloads\/nPos-telltea\.apk/);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/install\//);

const install = read("public/install/index.html");
assert.match(install, /nPos-telltea\.apk/);
assert.match(install, /latest\.json/);
assert.match(install, /versionName|versionValue|เวอร์ชันที่จะติดตั้ง/);
assert.match(install, /เช็คเลขเวอร์ชัน|ดาวน์โหลดเวอร์ชัน/);
assert.match(install, /qr-pos-install\.png/);
assert.match(install, /คัดลอกลิงก์ส่งพนักงาน/);
assert.match(install, /เมนูหน้าร้าน|เข้างาน/);
assert.doesNotMatch(install, /Hello World/);
assert.ok(existsSync(join(root, "public/install/qr-pos-install.png")));

assert.match(read("src/components/PosDeviceSetup.tsx"), /qr-pos-install\.png/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /ส่งให้พนักงานติดตั้ง/);
assert.doesNotMatch(read("src/components/PosDeviceSetup.tsx"), /ควรเห็นข้อความ <strong>Hello World<\/strong>/);
assert.match(read("src/lib/pos-ops-notes.ts"), /เข้างานแล้วขายได้|หน้าร้าน/);

assert.match(read(".github/workflows/deploy.yml"), /nPos-telltea/);
assert.match(read(".github/workflows/deploy.yml"), /cd npos-telltea/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /startCheck|buildHubNav/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /nPos-telltea/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /version_label/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+\d+/);
assert.match(read("npos-telltea/app/build.gradle"), /signingConfigs/);
assert.match(read("npos-telltea/app/build.gradle"), /npos-telltea\.jks/);
assert.match(read("npos-telltea/app/build.gradle"), /INSTALL_PAGE_URL/);
assert.ok(existsSync(join(root, "npos-telltea/keystore/npos-telltea.jks")));
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/update/ApkInstaller.java"), /Files still open|openWrite/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /openInstallPage|INSTALL_PAGE/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /btn_open_install_page/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateChecker.java"), /latest\.json|MANIFEST|manifestUrl/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/update/ApkInstaller.java"), /PackageInstaller/);
assert.match(read("scripts/publish-pos-apk.mjs"), /versionCode/);
assert.match(read("scripts/publish-pos-apk.mjs"), /apkUrl/);
assert.match(read("scripts/publish-pos-apk.mjs"), /nPos-telltea\.apk/);
assert.ok(existsSync(join(root, "npos-telltea/gradlew")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateManifest.java")));

console.log("test-pos-apk-download: ok");
