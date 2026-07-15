/**
 * Mobile UX: evidence upload progress advances (not stuck at 0%) for 4 files.
 * Simulates Firestore one-doc-per-photo path with stepped progress.
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const outDir = "/tmp/owner-books-photo-test";
mkdirSync(outDir, { recursive: true });
const MAX = 4;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence firestore progress</title>
<style>
  body { font-family: system-ui; margin: 12px; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; }
  .modal-card { background:#fff; border-radius:12px; padding:14px; width:min(22rem,92vw); }
  .bar-wrap { height:8px; background:#dde3db; border-radius:99px; overflow:hidden; }
  .bar { height:100%; background:#2f6b4f; transition: width .12s; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
</style></head><body>
<div id="root"></div>
<script type="module">
import {createElement as h, useState, useRef} from "https://esm.sh/react@19.0.0";
import {createRoot} from "https://esm.sh/react-dom@19.0.0/client";
const MAX = ${MAX};

function ProgressModal({ progress }) {
  return h("div", { className: "modal-backdrop", "data-testid": "progress-modal" },
    h("div", { className: "modal-card" },
      h("h2", null, "อัปโหลดรูปหลักฐาน"),
      h("p", { "data-testid": "msg" }, progress.message),
      h("p", { "data-testid": "pct" }, "รวม " + progress.overallPercent + "%"),
      h("div", { className: "bar-wrap" },
        h("div", { className: "bar", "data-testid": "bar", style: { width: progress.overallPercent + "%" } })),
    ),
  );
}

async function saveEvidence(files, onProgress) {
  const refs = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    for (const percent of [8, 55, 100]) {
      onProgress({
        fileIndex: i, fileCount: files.length, fileName: file.name,
        percent, overallPercent: Math.round(((i + percent / 100) / files.length) * 100),
        message: (percent < 50 ? "กำลังเตรียมไฟล์หลักฐาน…" : percent < 100 ? "กำลังบันทึกลงฐานข้อมูล…" : "บันทึกรูปหลักฐานแล้ว")
          + " (" + (i + 1) + "/" + files.length + ")",
      });
      await new Promise((r) => setTimeout(r, 30));
    }
    refs.push("evp:demo" + i);
  }
  return refs;
}

function Field() {
  const [values, setValues] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [maxPct, setMaxPct] = useState(0);
  const galleryRef = useRef(null);

  async function onFiles(list) {
    if (!list?.length) return;
    const batch = [...list].slice(0, MAX - values.length);
    setBusy(true);
    setMaxPct(0);
    try {
      const added = await saveEvidence(batch, (p) => {
        setProgress(p);
        setMaxPct((m) => Math.max(m, p.overallPercent));
      });
      setValues((v) => [...v, ...added]);
    } finally {
      setBusy(false);
      setProgress(null);
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  return h("div", null,
    h("button", { type: "button", "data-testid": "attach", disabled: busy,
      onClick: () => galleryRef.current?.click() }, busy ? "กำลังอัปโหลด..." : "+ แนบรูป"),
    h("input", { ref: galleryRef, "data-testid": "gallery", type: "file", accept: "image/*",
      multiple: true, className: "sr-only", onChange: (e) => onFiles(e.target.files) }),
    h("p", { "data-testid": "count" }, String(values.length)),
    h("p", { "data-testid": "max-pct" }, String(maxPct)),
    h("p", { "data-testid": "refs" }, values.join(",")),
    progress ? h(ProgressModal, { progress }) : null,
  );
}
createRoot(document.getElementById("root")).render(h(Field));
</script></body></html>`;

writeFileSync(`${outDir}/index.html`, html);
const tinyJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUTEhMWFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAEC/9oADAMBAAIQAxAAAAGqfAP/xAAZEAACAwEAAAAAAAAAAAAAAAABAgADESH/2gAIAQIBAT8BjYjn/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//9k=",
  "base64",
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
await page.goto("file://" + outDir + "/index.html", { waitUntil: "networkidle" });

const files = Array.from({ length: MAX }, (_, i) => ({
  name: `IMG_${i}.jpeg`,
  mimeType: "image/jpeg",
  buffer: tinyJpeg,
}));

await page.locator('[data-testid="gallery"]').setInputFiles(files);
await page.waitForSelector('[data-testid="progress-modal"]', { timeout: 5000 });
// Progress must leave 0% (not turtle)
await page.waitForFunction(
  () => Number(document.querySelector('[data-testid="max-pct"]')?.textContent || "0") >= 40,
  null,
  { timeout: 8000 },
);
await page.waitForFunction(
  (max) => document.querySelector('[data-testid="count"]')?.textContent === String(max),
  MAX,
  { timeout: 10000 },
);
const refs = await page.locator('[data-testid="refs"]').innerText();
assert.equal(refs.split(",").filter(Boolean).length, MAX);
assert.ok(refs.split(",").every((r) => r.startsWith("evp:")));
assert.ok(Number(await page.locator('[data-testid="max-pct"]').innerText()) >= 90);
await browser.close();
console.log("OK test-owner-books-multi-photo-ui", { max: MAX, refs });
