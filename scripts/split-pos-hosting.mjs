/**
 * Split static export into back-office (out/) and standalone POS (out-pos/).
 * - out-pos/ serves at https://telltea-pos.web.app/
 * - out/ no longer contains /pos/ (main site redirects old URL)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");
const OUT_POS = path.join(ROOT, "out-pos");
const POS_SRC = path.join(OUT, "pos", "index.html");
const POS_MANIFEST_SRC = path.join(ROOT, "public", "manifest-pos.webmanifest");

const POS_URL = "https://telltea-pos.web.app/";

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
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

copyFile(POS_SRC, path.join(OUT_POS, "index.html"));
copyDir(path.join(OUT, "_next"), path.join(OUT_POS, "_next"));

for (const file of ["version.json", "sw.js", "404.html"]) {
  const src = path.join(OUT, file);
  if (fs.existsSync(src)) copyFile(src, path.join(OUT_POS, file));
}

copyDir(path.join(OUT, "icons"), path.join(OUT_POS, "icons"));

const manifest = JSON.parse(fs.readFileSync(POS_MANIFEST_SRC, "utf8"));
manifest.id = "/";
manifest.start_url = "/";
manifest.scope = "/";
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

console.log(`OK split-pos-hosting → out-pos/ (POS at ${POS_URL})`);
console.log("OK removed out/pos/ from back-office export");
