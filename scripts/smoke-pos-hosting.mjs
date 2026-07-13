/**
 * Verify standalone POS hosting export (out-pos/pos/).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_POS = path.join(ROOT, "out-pos");
let failed = false;

function fail(msg) {
  console.error("FAIL:", msg);
  failed = true;
}

function ok(msg) {
  console.log("OK", msg);
}

if (!fs.existsSync(path.join(OUT_POS, "pos", "index.html"))) {
  fail("out-pos/pos/index.html missing");
} else {
  ok("POS /pos/index.html");
}

if (!fs.existsSync(path.join(OUT_POS, "_next"))) {
  fail("out-pos/_next missing");
} else {
  ok("POS _next assets");
}

if (!fs.existsSync(path.join(OUT_POS, "logo-mark.svg"))) {
  fail("out-pos/logo-mark.svg missing");
} else {
  ok("POS logo-mark.svg");
}

const manifestPath = path.join(OUT_POS, "manifest-pos.webmanifest");
if (!fs.existsSync(manifestPath)) {
  fail("out-pos/manifest-pos.webmanifest missing");
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.start_url !== "/pos/" || manifest.scope !== "/pos/") {
    fail(`manifest must use /pos/ scope, got start_url=${manifest.start_url}`);
  } else {
    ok("POS manifest /pos/ scope");
  }
}

if (fs.existsSync(path.join(ROOT, "out", "pos"))) {
  fail("out/pos still exists — back-office must not ship POS route");
} else {
  ok("back-office out/pos removed");
}

const urlSrc = fs.readFileSync(path.join(ROOT, "src/lib/pos-url.ts"), "utf8");
if (!urlSrc.includes("telltea-pos.web.app/pos/")) {
  fail("pos-url.ts must point to telltea-pos.web.app/pos/");
} else {
  ok("pos-url.ts → telltea-pos.web.app/pos/");
}

const layoutSrc = fs.readFileSync(path.join(ROOT, "src/components/AppRootProviders.tsx"), "utf8");
if (!layoutSrc.includes('pathname.startsWith("/pos/")')) {
  fail("AppRootProviders must skip auth on /pos routes");
} else {
  ok("POS skips back-office AuthProvider");
}

if (failed) process.exit(1);
console.log("\nPOS hosting export OK");
