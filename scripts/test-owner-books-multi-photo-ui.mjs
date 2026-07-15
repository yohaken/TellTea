/**
 * Mobile-first UX: multi-select up to max (6), same pattern as ledger PhotoAttachMultiField.
 * - iPhone viewport
 * - gallery input multiple=true
 * - attach batch of 6 → count + thumbs
 * - busy label clears (no stuck 「กำลังอัปโหลด...」)
 * - 7th file rejected at room limit
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const outDir = "/tmp/owner-books-photo-test";
mkdirSync(outDir, { recursive: true });
const MAX = 6;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Owner books multi mobile</title>
<style>
  body { font-family: system-ui; margin: 12px; }
  .receipt-actions { display: flex; gap: 8px; margin: 8px 0; }
  button:disabled { opacity: 0.55; }
  .photo-attach-multi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; list-style: none; padding: 0; }
  .photo-attach-multi-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
</head><body>
<div id="root"></div>
<script type="module">
import {createElement as h, useState, useRef} from "https://esm.sh/react@19.0.0";
import {createRoot} from "https://esm.sh/react-dom@19.0.0/client";

const MAX = ${MAX};

/** Encode like ledger default path (FileReader data URL) — no Storage. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read fail"));
    reader.readAsDataURL(file);
  });
}

function PhotoAttachMultiField({ max = MAX }) {
  const [values, setValues] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);

  async function onFiles(list) {
    if (!list?.length) return;
    const room = max - values.length;
    if (room <= 0) {
      setErr("แนบได้สูงสุด " + max + " รูป");
      return;
    }
    const batch = [...list].slice(0, room);
    setBusy(true);
    setErr("");
    const added = [];
    try {
      for (const file of batch) {
        added.push(await fileToDataUrl(file));
      }
      if (added.length) setValues((v) => [...v, ...added]);
    } catch (e) {
      setErr(e.message || "fail");
    } finally {
      setBusy(false);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  const full = values.length >= max;
  return h("div", { className: "field photo-attach-field photo-attach-multi" },
    h("span", { className: "field-label", "data-testid": "label" },
      "สลิป / รูปถ่าย (สูงสุด " + max + " รูป)"),
    h("p", { className: "muted", "data-testid": "hint" },
      "ถ่ายหรือแนบได้หลายใบ · สูงสุด " + max + " รูป"),
    h("div", { className: "receipt-actions" },
      h("button", {
        type: "button",
        className: "primary-btn",
        "data-testid": "camera",
        disabled: busy || full,
        onClick: () => cameraRef.current?.click(),
      }, busy ? "กำลังอัปโหลด..." : "ถ่ายรูป"),
      h("button", {
        type: "button",
        className: "ghost-btn",
        "data-testid": "attach",
        disabled: busy || full,
        onClick: () => galleryRef.current?.click(),
      }, "+ แนบรูป"),
    ),
    err ? h("p", { "data-testid": "error", className: "error" }, err) : null,
    h("p", { "data-testid": "count" }, String(values.length)),
    h("p", { "data-testid": "busy" }, busy ? "1" : "0"),
    values.length
      ? h("ul", { className: "photo-attach-multi-grid", "data-testid": "grid" },
          values.map((url, i) =>
            h("li", { key: i }, h("img", { src: url, alt: "", "data-testid": "thumb" })),
          ),
        )
      : null,
    h("input", {
      ref: cameraRef,
      "data-testid": "camera-input",
      type: "file",
      accept: "image/*",
      capture: "environment",
      className: "sr-only",
      onChange: (e) => onFiles(e.target.files),
    }),
    h("input", {
      ref: galleryRef,
      "data-testid": "gallery",
      type: "file",
      accept: "image/*",
      multiple: true,
      className: "sr-only",
      onChange: (e) => onFiles(e.target.files),
    }),
  );
}

createRoot(document.getElementById("root")).render(h(PhotoAttachMultiField));
</script></body></html>`;

const htmlPath = `${outDir}/index.html`;
writeFileSync(htmlPath, html);

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
await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });

const label = await page.locator('[data-testid="label"]').innerText();
assert.match(label, /สูงสุด 6 รูป/);
assert.match(await page.locator('[data-testid="hint"]').innerText(), /สูงสุด 6 รูป/);

const multiple = await page.locator('[data-testid="gallery"]').getAttribute("multiple");
assert.ok(multiple !== null, "gallery input must allow multiple");

// Multi-select full quota in one gallery pick (mobile long-press select many → one FileList)
const six = Array.from({ length: MAX }, (_, i) => filePayload(`slip-${i + 1}.jpg`));
await page.locator('[data-testid="gallery"]').setInputFiles(six);

await page.waitForFunction(
  (max) => document.querySelector('[data-testid="count"]')?.textContent === String(max),
  MAX,
);
assert.equal(await page.locator('[data-testid="count"]').innerText(), String(MAX));
assert.equal(await page.locator('[data-testid="thumb"]').count(), MAX);
assert.equal(await page.locator('[data-testid="busy"]').innerText(), "0");
assert.notEqual(await page.locator('[data-testid="camera"]').innerText(), "กำลังอัปโหลด...");

// At max: attach disabled, extra file does not grow past max
assert.equal(await page.locator('[data-testid="attach"]').isDisabled(), true);
await page.locator('[data-testid="gallery"]').setInputFiles([filePayload("extra.jpg")]);
await page.waitForTimeout(200);
assert.equal(await page.locator('[data-testid="count"]').innerText(), String(MAX));

await page.screenshot({ path: `${outDir}/mobile-max-6.png`, fullPage: true });
await browser.close();
console.log("OK test-owner-books-multi-photo-ui", {
  label,
  max: MAX,
  mobile: true,
  screenshot: `${outDir}/mobile-max-6.png`,
});
