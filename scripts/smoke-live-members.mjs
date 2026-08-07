/**
 * Live guard: /members/ must be the members page (not Next soft-404).
 */
import assert from "node:assert/strict";

const BASE = process.env.TELLTEA_SHOP_URL || "https://telltea-shop.web.app";

async function main() {
  const verRes = await fetch(`${BASE}/version.json`, { cache: "no-store" });
  assert.equal(verRes.status, 200, "version.json HTTP");
  const ver = await verRes.json();
  assert.ok(Number(ver.build) >= 726, `build too old: ${ver.build}`);

  const res = await fetch(`${BASE}/members/`, { cache: "no-store" });
  assert.equal(res.status, 200, "/members/ HTTP");
  const html = await res.text();
  assert.match(html, /app\/members\/page-/, "missing members page chunk");
  assert.doesNotMatch(html, /<title>404:/, "soft/hard 404 title");
  assert.match(html, /กำลังตรวจสอบสิทธิ์|members-hub|สมาชิก/, "auth gate or members UI");
  console.log(`OK smoke-live-members · ${BASE}/members/ · build ${ver.build}`);
}

main().catch((err) => {
  console.error("FAIL smoke-live-members", err);
  process.exit(1);
});
