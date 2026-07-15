/**
 * Browser UX: evidence upload progress leaves 0% and yields evp: ref.
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const outDir = "/tmp/evidence-rollout-test";
mkdirSync(outDir, { recursive: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence field</title>
<style>
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.modal-card{background:#fff;padding:12px;border-radius:12px;width:min(22rem,92vw)}
.bar{height:8px;background:#2f6b4f;transition:width .1s}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
</style></head><body><div id="root"></div>
<script type="module">
import {createElement as h, useState, useRef} from "https://esm.sh/react@19.0.0";
import {createRoot} from "https://esm.sh/react-dom@19.0.0/client";

async function uploadEvidencePhotos(files, { onProgress }) {
  const file = files[0];
  for (const percent of [10, 55, 100]) {
    onProgress({
      phase: percent < 50 ? "preparing" : percent < 100 ? "uploading" : "done",
      fileIndex: 0, fileCount: 1, fileName: file.name,
      percent, overallPercent: percent, online: true,
      message: "กำลังบันทึก (" + percent + "%)",
      bytesTransferred: 0, totalBytes: file.size || 1,
    });
    await new Promise((r) => setTimeout(r, 40));
  }
  return ["evp:rollout1"];
}

function Field({ folder }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [maxPct, setMaxPct] = useState(0);
  const ref = useRef(null);
  async function onFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const urls = await uploadEvidencePhotos([file], {
        onProgress: (p) => { setProgress(p); setMaxPct((m) => Math.max(m, p.overallPercent)); },
      });
      setValue(urls[0]);
    } finally {
      setBusy(false);
      setProgress(null);
      if (ref.current) ref.current.value = "";
    }
  }
  return h("div", null,
    h("p", { "data-testid": "folder" }, folder),
    h("button", { type: "button", "data-testid": "attach", disabled: busy,
      onClick: () => ref.current?.click() }, busy ? "กำลังอัปโหลด..." : "แนบรูป"),
    h("input", { ref, "data-testid": "file", type: "file", accept: "image/*", className: "sr-only",
      onChange: (e) => onFile(e.target.files?.[0]) }),
    h("p", { "data-testid": "value" }, value),
    h("p", { "data-testid": "max-pct" }, String(maxPct)),
    progress ? h("div", { "data-testid": "progress-modal", className: "modal-backdrop" },
      h("div", { className: "modal-card" },
        h("p", { "data-testid": "msg" }, progress.message),
        h("div", { className: "bar", style: { width: progress.overallPercent + "%" } }),
      )) : null,
  );
}
createRoot(document.getElementById("root")).render(h(Field, { folder: "ledger-receipts" }));
</script></body></html>`;

writeFileSync(`${outDir}/index.html`, html);
const tinyJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUTEhMWFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAEC/9oADAMBAAIQAxAAAAGqfAP/xAAZEAACAwEAAAAAAAAAAAAAAAABAgADESH/2gAIAQIBAT8BjYjn/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//9k=",
  "base64",
);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})).newPage();
await page.goto("file://" + outDir + "/index.html", { waitUntil: "networkidle" });
assert.equal(await page.locator('[data-testid="folder"]').innerText(), "ledger-receipts");
await page.locator('[data-testid="file"]').setInputFiles({
  name: "slip.jpg",
  mimeType: "image/jpeg",
  buffer: tinyJpeg,
});
await page.waitForSelector('[data-testid="progress-modal"]');
await page.waitForFunction(
  () => Number(document.querySelector('[data-testid="max-pct"]')?.textContent || "0") >= 40,
);
await page.waitForFunction(
  () => (document.querySelector('[data-testid="value"]')?.textContent || "").startsWith("evp:"),
);
assert.match(await page.locator('[data-testid="value"]').innerText(), /^evp:/);
assert.ok(Number(await page.locator('[data-testid="max-pct"]').innerText()) >= 90);
await browser.close();
console.log("OK test-evidence-rollout-ui");
