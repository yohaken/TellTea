#!/usr/bin/env node
/**
 * Upload Grab menu ZIP via Chrome bulk editor (names / availability).
 * Serves ZIP with CORS so merchant.grab.com can fetch it into the file input.
 *
 *   node scripts/grab-chrome-bulk-upload.mjs --zip=scripts/data/menu-price-baseline/grab-rename-names-to-pos.zip
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { findGrabTab, chromeJsOnTab, sleep, GRAB_STORE_ID } from "./lib/grab-chrome.mjs";

const zipArg = process.argv.find((a) => a.startsWith("--zip="));
const zipPath = resolve(zipArg ? zipArg.slice(6) : "scripts/data/menu-price-baseline/grab-rename-names-to-pos.zip");
if (!existsSync(zipPath)) throw new Error(`Missing zip: ${zipPath}`);

const PORT = 8766;
const fileName = basename(zipPath);
const bytes = readFileSync(zipPath);

function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === `/${fileName}` || req.url === "/") {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": bytes.length,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    server.listen(PORT, "127.0.0.1", () => resolvePromise(server));
  });
}

async function main() {
  const server = await startServer();
  console.log(`Serving http://127.0.0.1:${PORT}/${fileName} (${bytes.length} bytes)`);

  try {
    const { windowIndex, tabIndex } = findGrabTab();
    chromeJsOnTab(
      tabIndex,
      `(() => { location.href='https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/bulkUploadMenu'; return 'ok'; })()`,
      { windowIndex },
    );
    await sleep(3000);

    chromeJsOnTab(
      tabIndex,
      `(() => {
        for (const el of document.querySelectorAll('button,span')) {
          if ((el.innerText||'').trim() === 'แก้ไขหลายรายการ') { el.click(); return 'opened'; }
        }
        return 'miss';
      })()`,
      { windowIndex },
    );
    await sleep(2000);

    const inject = `
(async () => {
  try {
    const res = await fetch('http://127.0.0.1:${PORT}/${fileName}');
    if (!res.ok) return JSON.stringify({ err: 'fetch ' + res.status });
    const blob = await res.blob();
    const file = new File([blob], '${fileName}', { type: 'application/zip' });
    const input = document.querySelector('#INPUT_ID') || document.querySelector('input[type=file]');
    if (!input) return JSON.stringify({ err: 'no input' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // some Grab UIs listen to drop
    const zone = input.closest('div') || input.parentElement;
    if (zone) {
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: dt });
      zone.dispatchEvent(drop);
    }
    return JSON.stringify({ ok: true, name: input.files[0]?.name, size: input.files[0]?.size });
  } catch (e) {
    return JSON.stringify({ err: String(e) });
  }
})()
`;

    chromeJsOnTab(
      tabIndex,
      `(() => { window.__grabBulk = 'pending'; (${inject.replace(/;$/, "")}).then(r => window.__grabBulk = r); return 'started'; })()`,
      { windowIndex },
    );

    let result = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const raw = chromeJsOnTab(tabIndex, `(() => window.__grabBulk || 'pending')()`, { windowIndex });
      if (raw && raw !== "pending" && raw !== "started") {
        result = raw;
        break;
      }
    }
    console.log("inject:", result);

    await sleep(1500);
    // click submit if present
    const submit = chromeJsOnTab(
      tabIndex,
      `(() => {
        for (const label of ['ลงขาย', 'อัปโหลด', 'ยืนยัน', 'Submit', 'Upload']) {
          for (const b of document.querySelectorAll('button')) {
            if ((b.innerText||'').trim() === label) { b.click(); return 'clicked:'+label; }
          }
        }
        return 'no-submit · sample:' + (document.body.innerText||'').slice(0,600);
      })()`,
      { windowIndex },
    );
    console.log("submit:", submit);

    await sleep(4000);
    const after = chromeJsOnTab(
      tabIndex,
      `(() => JSON.stringify({ url: location.href, sample: (document.body.innerText||'').slice(0,1500) }))()`,
      { windowIndex },
    );
    console.log("after:", after);
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
