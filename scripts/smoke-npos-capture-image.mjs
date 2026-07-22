/**
 * Live user-view check: upload a distinctive JPEG → open returned URL →
 * assert real image bytes (not blank / not JSON 412).
 *
 *   node scripts/smoke-npos-capture-image.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPORT =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/reportNposScreenCapture";
const outDir = "/opt/cursor/artifacts/npos-capture-smoke";
mkdirSync(outDir, { recursive: true });

const srcPath = join(outDir, "source.jpg");
const gen = spawnSync(
  "python3",
  [
    "-c",
    `
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime, timezone
import os
W,H=960,540
im=Image.new('RGB',(W,H),(30,80,60))
d=ImageDraw.Draw(im)
for i in range(0,W,40): d.line([(i,0),(i,H)], fill=(20,60,45), width=1)
d.rectangle([40,40,W-40,H-40], outline=(196,163,90), width=6)
d.rectangle([80,120,W-80,280], fill=(232,93,36))
ts=datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')
try:
  font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 42)
  font2=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 28)
except Exception:
  font=ImageFont.load_default(); font2=font
d.text((100,150), 'nPos CAPTURE SMOKE', fill=(255,255,255), font=font)
d.text((100,210), ts, fill=(255,240,220), font=font2)
d.text((100,340), 'REAL IMAGE CHECK', fill=(243,246,242), font=font2)
d.ellipse([700,320,880,480], fill=(61,220,132))
im.save(${JSON.stringify(srcPath)}, 'JPEG', quality=85)
print(os.path.getsize(${JSON.stringify(srcPath)}))
`,
  ],
  { encoding: "utf8" },
);
if (gen.status !== 0) {
  console.error(gen.stderr || gen.stdout);
  process.exit(1);
}

const jpeg = readFileSync(srcPath);
const installId = "npos-smoke-" + Date.now().toString(36);
const body = {
  installId,
  stableKey: "smoketest01",
  isEmulator: true,
  deviceClass: "dev",
  reason: "smoke_user_view",
  requestAt: Date.now(),
  capturedAt: Date.now(),
  customerDisplay: "missing",
  displays: [],
  primary: {
    ok: true,
    detail: "smoke",
    width: 960,
    height: 540,
    jpegBase64: jpeg.toString("base64"),
  },
  secondary: { ok: false, detail: "none", width: 0, height: 0 },
};

const res = await fetch(REPORT, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
writeFileSync(join(outDir, "cf-response.json"), JSON.stringify(json, null, 2));
console.log("CF", res.status, "hasImages=", json.hasImages, "urlHost=", (() => {
  try {
    return new URL(json.primaryUrl || "").host;
  } catch {
    return "";
  }
})());

if (!res.ok || !json.ok || !json.primaryUrl) {
  console.error("FAIL: no primaryUrl", json);
  process.exit(2);
}

const url = String(json.primaryUrl);
const isProxy = url.includes("nposCaptureMedia");
const isToken =
  url.includes("firebasestorage.googleapis.com") && url.includes("token=");
console.log("urlKind", isProxy ? "media-proxy" : isToken ? "firebase-token" : "other");

const imgRes = await fetch(url);
const buf = Buffer.from(await imgRes.arrayBuffer());
const ct = imgRes.headers.get("content-type") || "";
writeFileSync(join(outDir, "fetched.jpg"), buf);
writeFileSync(
  join(outDir, "fetch-meta.json"),
  JSON.stringify(
    {
      httpStatus: imgRes.status,
      contentType: ct,
      bytes: buf.length,
      jpegMagic: buf[0] === 0xff && buf[1] === 0xd8,
      sha256_16: createHash("sha256").update(buf).digest("hex").slice(0, 16),
      urlKind: isProxy ? "media-proxy" : isToken ? "firebase-token" : "other",
      shotId: json.shotId,
      urlPrefix: url.slice(0, 140),
    },
    null,
    2,
  ),
);

const analyze = spawnSync(
  "python3",
  [
    "-c",
    `
from PIL import Image
import json, statistics
im=Image.open(${JSON.stringify(join(outDir, "fetched.jpg"))}).convert('RGB')
w,h=im.size
# sample grid for variance + orange detection
xs=list(range(0,w,max(1,w//24)))
ys=list(range(0,h,max(1,h//16)))
pix=[im.getpixel((x,y)) for y in ys for x in xs]
rs=[p[0] for p in pix]; gs=[p[1] for p in pix]; bs=[p[2] for p in pix]
var=statistics.pvariance(rs)+statistics.pvariance(gs)+statistics.pvariance(bs)
# orange box region around (480,200)
ox,oy=min(w-1,480),min(h-1,200)
o=im.getpixel((ox,oy))
orange = o[0]>180 and o[1]<140 and o[2]<80
out={
  'width':w,'height':h,'variance':round(var,1),
  'sample_center':list(im.getpixel((w//2,h//2))),
  'sample_orange_zone':list(o),'looks_orange_banner':orange,
  'not_blank': var>200 and w>=100 and h>=100,
}
print(json.dumps(out))
`,
  ],
  { encoding: "utf8" },
);

let vision = {};
try {
  vision = JSON.parse(analyze.stdout.trim() || "{}");
} catch {
  vision = { parseError: analyze.stderr || analyze.stdout };
}
writeFileSync(join(outDir, "vision.json"), JSON.stringify(vision, null, 2));
console.log("FETCH", imgRes.status, ct, "bytes", buf.length, "jpeg", buf[0] === 0xff);
console.log("VISION", vision);

const ok =
  imgRes.ok &&
  buf[0] === 0xff &&
  buf[1] === 0xd8 &&
  buf.length > 5000 &&
  vision.not_blank === true &&
  !isToken;

if (!ok) {
  console.error("FAIL: user would not see a real image");
  if (isToken) console.error("still returning firebase token URL (412 risk)");
  process.exit(3);
}
console.log("OK smoke-npos-capture-image — real non-blank JPEG visible at URL");
