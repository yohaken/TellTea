/**
 * Mobile-first: evidence upload progress popup + multi-select to max (6).
 * Simulates buffer + Storage progress UX (prototype for app-wide photo modules).
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const outDir = "/tmp/owner-books-photo-test";
mkdirSync(outDir, { recursive: true });
const MAX = 6;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence upload progress</title>
<style>
  body { font-family: system-ui; margin: 12px; background: #f4f6f3; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index: 20; }
  .modal-card { background: #fff; border-radius: 12px; padding: 14px; width: min(22rem, 92vw); }
  .bar-wrap { height: 8px; background: #dde3db; border-radius: 99px; overflow: hidden; }
  .bar { height: 100%; background: #2f6b4f; transition: width .15s; }
  .grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; list-style: none; padding: 0; }
  .grid img { width: 100%; aspect-ratio: 1; object-fit: cover; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
  .chip[data-online="0"] { color: #b42318; }
  button:disabled { opacity: .55; }
</style></head><body>
<div id="root"></div>
<script type="module">
import {createElement as h, useState, useRef} from "https://esm.sh/react@19.0.0";
import {createRoot} from "https://esm.sh/react-dom@19.0.0/client";

const MAX = ${MAX};

function ProgressModal({ progress }) {
  return h("div", { className: "modal-backdrop", "data-testid": "progress-modal" },
    h("div", { className: "modal-card", role: "dialog", "aria-label": "สถานะอัปโหลดรูป" },
      h("h2", null, "อัปโหลดรูปหลักฐาน"),
      h("p", { "data-testid": "conn" }, "การเชื่อมต่อ: ",
        h("strong", null, progress.online ? "ออนไลน์ — เชื่อมคลังรูปแล้ว" : "ออฟไลน์")),
      h("p", { "data-testid": "msg" }, progress.message),
      h("p", { "data-testid": "file-label" },
        "รูปที่ " + (progress.fileIndex + 1) + " / " + progress.fileCount),
      h("div", { className: "bar-wrap" },
        h("div", { className: "bar", "data-testid": "bar", style: { width: progress.overallPercent + "%" } })),
      h("p", { "data-testid": "pct" }, "รวม " + progress.overallPercent + "%"),
      h("p", null, "กรุณารอจนครบ — อัปโหลดไฟล์จริงไปคลังรูป"),
    ),
  );
}

/** Simulated Storage buffer: sequential upload with progress (no downscale). */
async function uploadEvidence(files, onProgress) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({
      phase: "checking", fileIndex: i, fileCount: files.length, fileName: file.name,
      percent: 0, overallPercent: Math.round((i / files.length) * 100),
      online: true, message: "กำลังตรวจสอบการเชื่อมต่อคลังรูป…",
    });
    await new Promise((r) => setTimeout(r, 40));
    onProgress({
      phase: "preparing", fileIndex: i, fileCount: files.length, fileName: file.name,
      percent: 0, overallPercent: Math.round((i / files.length) * 100),
      online: true, message: "กำลังเตรียมไฟล์หลักฐาน (คงคุณภาพ)…",
    });
    await new Promise((r) => setTimeout(r, 40));
    for (const pct of [20, 55, 100]) {
      onProgress({
        phase: "uploading", fileIndex: i, fileCount: files.length, fileName: file.name,
        percent: pct,
        overallPercent: Math.round(((i + pct / 100) / files.length) * 100),
        online: true,
        message: "กำลังอัปโหลดไปคลังรูป (" + (i + 1) + "/" + files.length + ") " + pct + "%",
      });
      await new Promise((r) => setTimeout(r, 35));
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(file);
    });
    // Prototype stores remote-like https placeholders after "upload"
    urls.push("https://firebasestorage.googleapis.com/v0/b/demo/o/ob%2F" + i + "?alt=media");
    void dataUrl;
  }
  onProgress({
    phase: "done", fileIndex: files.length - 1, fileCount: files.length, fileName: "",
    percent: 100, overallPercent: 100, online: true, message: "อัปโหลดครบ " + files.length + " รูปแล้ว",
  });
  return urls;
}

function Field() {
  const [values, setValues] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [online] = useState(true);
  const galleryRef = useRef(null);

  async function onFiles(list) {
    if (!list?.length) return;
    const room = MAX - values.length;
    if (room <= 0) return;
    const batch = [...list].slice(0, room);
    setBusy(true);
    try {
      const added = await uploadEvidence(batch, setProgress);
      setValues((v) => [...v, ...added]);
    } finally {
      setBusy(false);
      setProgress(null);
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  return h("div", null,
    h("span", { "data-testid": "label" }, "สลิป / รูปถ่าย (สูงสุด " + MAX + " รูป)"),
    h("p", { className: "chip", "data-testid": "conn-chip", "data-online": online ? "1" : "0" },
      online ? "พร้อมอัปโหลด (ออนไลน์)" : "ออฟไลน์"),
    h("button", {
      type: "button", "data-testid": "attach", disabled: busy,
      onClick: () => galleryRef.current?.click(),
    }, busy ? "กำลังอัปโหลด..." : "+ แนบรูป"),
    h("input", {
      ref: galleryRef, "data-testid": "gallery", type: "file", accept: "image/*",
      multiple: true, className: "sr-only",
      onChange: (e) => onFiles(e.target.files),
    }),
    h("p", { "data-testid": "count" }, String(values.length)),
    h("p", { "data-testid": "busy" }, busy ? "1" : "0"),
    values.length ? h("ul", { className: "grid", "data-testid": "grid" },
      values.map((url, i) => h("li", { key: i }, h("img", { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", alt: "", "data-remote": url })))
    ) : null,
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

function filePayload(name) {
  return { name, mimeType: "image/jpeg", buffer: tinyJpeg };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
await page.goto("file://" + outDir + "/index.html", { waitUntil: "networkidle" });

assert.match(await page.locator('[data-testid="label"]').innerText(), /สูงสุด 6 รูป/);
assert.equal(await page.locator('[data-testid="conn-chip"]').getAttribute("data-online"), "1");
assert.ok((await page.locator('[data-testid="gallery"]').getAttribute("multiple")) !== null);

const six = Array.from({ length: MAX }, (_, i) => filePayload(`evidence-${i + 1}.jpg`));

const progressSeen = page.waitForSelector('[data-testid="progress-modal"]', { timeout: 5000 });
await page.locator('[data-testid="gallery"]').setInputFiles(six);
await progressSeen;

assert.match(await page.locator('[data-testid="conn"]').innerText(), /ออนไลน์|คลังรูป/);
assert.match(await page.locator('[data-testid="msg"]').innerText(), /คลังรูป|หลักฐาน|อัปโหลด/);

await page.waitForFunction(
  (max) => document.querySelector('[data-testid="count"]')?.textContent === String(max),
  MAX,
  { timeout: 15000 },
);

assert.equal(await page.locator('[data-testid="count"]').innerText(), String(MAX));
assert.equal(await page.locator('[data-testid="busy"]').innerText(), "0");
assert.equal(await page.locator('[data-testid="progress-modal"]').count(), 0);

const remotes = await page.locator("[data-remote]").evaluateAll((nodes) =>
  nodes.map((n) => n.getAttribute("data-remote") || ""),
);
assert.equal(remotes.length, MAX);
assert.ok(remotes.every((u) => u.startsWith("https://")), "all urls must be remote https");

await page.screenshot({ path: `${outDir}/mobile-evidence-progress.png`, fullPage: true });
await browser.close();
console.log("OK test-owner-books-multi-photo-ui", { max: MAX, remotes: remotes.length });
