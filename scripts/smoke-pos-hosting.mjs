/**
 * Verify standalone POS hosting export (out-pos/).
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

if (!fs.existsSync(path.join(OUT_POS, "index.html"))) {
  fail("out-pos/index.html missing");
} else {
  ok("POS root index.html");
}

if (!fs.existsSync(path.join(OUT_POS, "_next"))) {
  fail("out-pos/_next missing");
} else {
  ok("POS _next assets");
}

const manifestPath = path.join(OUT_POS, "manifest-pos.webmanifest");
if (!fs.existsSync(manifestPath)) {
  fail("out-pos/manifest-pos.webmanifest missing");
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.start_url !== "/" || manifest.scope !== "/") {
    fail(`manifest must use root scope, got start_url=${manifest.start_url}`);
  } else {
    ok("POS manifest root scope");
  }
}

if (fs.existsSync(path.join(ROOT, "out", "pos"))) {
  fail("out/pos still exists — back-office must not ship POS route");
} else {
  ok("back-office out/pos removed");
}

const urlSrc = fs.readFileSync(path.join(ROOT, "src/lib/pos-url.ts"), "utf8");
if (!urlSrc.includes("telltea-pos.web.app")) {
  fail("pos-url.ts must point to telltea-pos.web.app");
} else {
  ok("pos-url.ts → telltea-pos.web.app");
}

if (failed) process.exit(1);
console.log("\nPOS hosting export OK");
