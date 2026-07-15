/**
 * Browser UX test: gallery input with multiple=true accepts 3 files at once
 * (mirrors PhotoAttachMultiField / owner-books slip attach).
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const outDir = "/tmp/owner-books-photo-test";
mkdirSync(outDir, { recursive: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Owner books multi</title></head><body>
<div id="root"></div>
<script type="module">
import {createElement as h, useState, useRef} from "https://esm.sh/react@19.0.0";
import {createRoot} from "https://esm.sh/react-dom@19.0.0/client";

function Field({max=6}) {
  const [values, setValues] = useState([]);
  const galleryRef = useRef(null);
  async function onFiles(list) {
    if (!list?.length) return;
    const room = max - values.length;
    const batch = [...list].slice(0, room);
    const added = [];
    for (const file of batch) {
      added.push(URL.createObjectURL(file));
    }
    setValues(v => [...v, ...added]);
  }
  return h("div", null,
    h("label", {"data-testid":"label"}, \`สลิป / รูปถ่าย (สูงสุด \${max} รูป)\`),
    h("button", {
      type:"button",
      "data-testid":"attach",
      onClick: () => galleryRef.current?.click()
    }, "แนบรูป"),
    h("input", {
      ref: galleryRef,
      "data-testid":"gallery",
      type:"file",
      accept:"image/*",
      multiple: true,
      className: "sr-only",
      onChange: (e) => onFiles(e.target.files)
    }),
    h("p", {"data-testid":"count"}, String(values.length)),
    h("ul", {"data-testid":"grid"},
      values.map((url,i) => h("li", {key:i}, h("img", {src:url, alt:"", width:40, height:40})))
    ),
    values.length ? h("span", {"data-testid":"badge", className:"photo-status-count"}, String(values.length)) : null,
  );
}
createRoot(document.getElementById("root")).render(h(Field));
</script></body></html>`;

const htmlPath = `${outDir}/index.html`;
writeFileSync(htmlPath, html);

const tinyJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUTEhMWFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAEC/9oADAMBAAIQAxAAAAGqfAP/xAAZEAACAwEAAAAAAAAAAAAAAAABAgADESH/2gAIAQIBAT8BjYjn/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//9k=",
  "base64",
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });

const label = await page.locator('[data-testid="label"]').innerText();
assert.match(label, /สูงสุด 6 รูป/);

const multiple = await page.locator('[data-testid="gallery"]').getAttribute("multiple");
assert.ok(multiple !== null, "gallery input must allow multiple");

await page.locator('[data-testid="gallery"]').setInputFiles([
  { name: "a.jpg", mimeType: "image/jpeg", buffer: tinyJpeg },
  { name: "b.jpg", mimeType: "image/jpeg", buffer: tinyJpeg },
  { name: "c.jpg", mimeType: "image/jpeg", buffer: tinyJpeg },
]);

await page.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === "3");

assert.equal(await page.locator('[data-testid="count"]').innerText(), "3");
assert.equal(await page.locator('[data-testid="grid"] img').count(), 3);
assert.equal(await page.locator('[data-testid="badge"]').innerText(), "3");

await browser.close();
console.log("OK test-owner-books-multi-photo-ui", { label, multiple: multiple !== null });
