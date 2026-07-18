/**
 * Split static export: back-office (out/) vs POS site (out-pos/) at /pos/ path.
 * Next.js POS route must stay /pos/ — do not serve at root (breaks client router).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");
const OUT_POS = path.join(ROOT, "out-pos");
const POS_SRC = path.join(OUT, "pos", "index.html");
const POS_MANIFEST_SRC = path.join(ROOT, "public", "manifest-pos.webmanifest");

export const POS_PUBLIC_URL = "https://telltea-pos.web.app/pos/";

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
}

if (!fs.existsSync(POS_SRC)) {
  console.error("FAIL: missing out/pos/index.html — run next build first");
  process.exit(1);
}

rmrf(OUT_POS);
fs.mkdirSync(OUT_POS, { recursive: true });

copyDir(path.join(OUT, "pos"), path.join(OUT_POS, "pos"));
copyDir(path.join(OUT, "_next"), path.join(OUT_POS, "_next"));
copyDir(path.join(OUT, "icons"), path.join(OUT_POS, "icons"));

for (const file of [
  "version.json",
  "pos-version.json",
  "sw.js",
  "404.html",
  "favicon.ico",
  "logo-mark.svg",
  "logo-telltea.svg",
  "hero-tea.svg",
]) {
  copyFile(path.join(OUT, file), path.join(OUT_POS, file));
}

/** หน้าดาวน์โหลด APK คงที่ — https://telltea-pos.web.app/install/ */
copyDir(path.join(OUT, "install"), path.join(OUT_POS, "install"));
copyDir(path.join(ROOT, "public", "install"), path.join(OUT_POS, "install"));
copyDir(path.join(ROOT, "public", "downloads"), path.join(OUT_POS, "downloads"));

const manifest = JSON.parse(fs.readFileSync(POS_MANIFEST_SRC, "utf8"));
manifest.id = "/pos/";
manifest.start_url = "/pos/";
manifest.scope = "/pos/";
fs.writeFileSync(
  path.join(OUT_POS, "manifest-pos.webmanifest"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const posDir = path.join(OUT, "pos");
if (fs.existsSync(posDir)) {
  fs.rmSync(posDir, { recursive: true, force: true });
}

for (const file of ["manifest-pos.webmanifest"]) {
  const p = path.join(OUT, file);
  if (fs.existsSync(p)) fs.rmSync(p);
}

console.log(`OK split-pos-hosting → out-pos/pos/ (${POS_PUBLIC_URL})`);
console.log("OK removed out/pos/ from back-office export");
