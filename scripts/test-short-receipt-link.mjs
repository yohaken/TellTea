/**
 * Guard: short slip QR /r/* redirects; long /claim /gift stay valid.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const shortTs = read("src/lib/short-receipt-link.ts");
assert.match(shortTs, /buildShortClaimPath/);
assert.match(shortTs, /buildShortGiftPath/);
assert.match(shortTs, /resolveShortReceiptLink/);
assert.match(shortTs, /\/r\/c\//);
assert.match(shortTs, /\/r\/g\//);

// Inline resolve mirror (keep in sync with short-receipt-link.ts)
function resolveShortReceiptLink(pathname, search = "") {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "r") {
    if (parts[1] === "c" && parts[2] && parts[3] && !parts[4]) {
      const s = encodeURIComponent(decodeURIComponent(parts[2]));
      const t = encodeURIComponent(decodeURIComponent(parts[3]));
      return `/claim/?s=${s}&t=${t}`;
    }
    if (parts[1] === "g" && parts[2] && !parts[3]) {
      const c = encodeURIComponent(decodeURIComponent(parts[2]));
      return `/gift/?c=${c}`;
    }
  }
  const qs = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const s = (qs.get("s") || qs.get("saleId") || "").trim();
  const t = (qs.get("t") || qs.get("token") || "").trim();
  if (s && t) {
    return `/claim/?s=${encodeURIComponent(s)}&t=${encodeURIComponent(t)}`;
  }
  const g = (qs.get("g") || qs.get("c") || "").trim();
  if (g && parts[0] === "r") {
    return `/gift/?c=${encodeURIComponent(g)}`;
  }
  return null;
}

assert.equal(
  resolveShortReceiptLink("/r/c/sale1/tokabc/"),
  "/claim/?s=sale1&t=tokabc",
);
assert.equal(
  resolveShortReceiptLink("/r/g/gifttoken/"),
  "/gift/?c=gifttoken",
);
assert.equal(resolveShortReceiptLink("/r/"), null);
assert.equal(
  resolveShortReceiptLink("/r/", "?s=sale1&t=tokabc"),
  "/claim/?s=sale1&t=tokabc",
);

const page = read("src/app/r/page.tsx");
assert.match(page, /resolveShortReceiptLink/);
assert.match(page, /window\.location\.pathname/);
assert.match(page, /location\.replace/);

const firebase = read("firebase.json");
assert.match(firebase, /"source": "\/r\/\*\*"/);
assert.match(firebase, /"destination": "\/r\/index\.html"/);

const providers = read("src/components/AppRootProviders.tsx");
assert.match(providers, /isPublicShortLink/);

const membersFn = read("functions/pos-members.js");
assert.match(membersFn, /telltea-bo\.web\.app\/r\/c\//);
assert.match(membersFn, /telltea-bo\.web\.app\/r\/g\//);
// Long paths still documented / claim pages still present
assert.match(read("src/app/claim/page.tsx"), /submitReceiptClaim/);
assert.match(read("src/app/gift/page.tsx"), /submitCompCouponClaim/);

const receipt = read("src/lib/receipt-claim.ts");
assert.match(receipt, /buildShortClaimPath|buildClaimPath/);
assert.match(receipt, /buildShortClaimUrl|buildClaimUrl/);

console.log("OK test-short-receipt-link");
