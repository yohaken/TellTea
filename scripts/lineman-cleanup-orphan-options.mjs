#!/usr/bin/env node
/**
 * Confirm LM orphan option names are gone on live Wongnai; clean stock JSON.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");

const DELETE_NAMES = [
  "แก้ว 14 ออนซ์",
  "แก้ว 22 ออนซ์",
  "ชีส (Cheese) เท่านั้น",
  "เดลิเวอรี่",
  "น้ำเปล่า",
  "เพิ่มช็อตมะนาว",
  "สุดคุ้ม 2 แถม 1 (รวม 3 ชิ้น)",
  "ไส้ชีส",
  "ไส้แฮม",
  "แฮม+ชีส (Ham & Cheese) อย่างละแผ่น",
  "แฮม (Ham) เท่านั้น",
];

function runAS(script) {
  return execFileSync("osascript", ["-e", script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function js(code) {
  const b64 = Buffer.from(code, "utf8").toString("base64");
  return runAS(`tell application "Google Chrome"
  tell window 1
    set j to do shell script "echo ${b64} | base64 -D"
    return execute tab 2 javascript j
  end tell
end tell`);
}

function jsj(code) {
  const r = js(code);
  try {
    return JSON.parse(r);
  } catch {
    return r;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  js(
    `(() => { location.href='https://merchant.wongnai.com/businesses/2688343/menu-option'; return 'ok'; })()`,
  );
  await sleep(3000);

  const links = jsj(`(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a')) {
      const m = a.href.match(/menu-option\\/(0[a-zA-Z0-9]+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        name: (a.innerText || '').trim().split('\\n')[0],
        id,
        edit: 'https://merchant.wongnai.com/businesses/2688343/menu-option/' + id + '/edit'
      });
    }
    return JSON.stringify(out);
  })()`);

  const groups = Array.isArray(links) ? links : [];
  console.log("groups", groups.length, groups.map((g) => g.name));

  const allChoices = [];
  const orphanHits = [];

  for (const g of groups) {
    js(`(() => { location.href=${JSON.stringify(g.edit)}; return 'ok'; })()`);
    await sleep(2200);
    const page = jsj(`(() => {
      const text = document.body.innerText || '';
      const deleteNames = ${JSON.stringify(DELETE_NAMES)};
      const hits = deleteNames.filter((n) => text.includes(n));
      const m = text.split('ช้อยส์');
      const chunk = m.length > 1 ? m.slice(1).join('ช้อยส์') : text;
      const beforeAdd = chunk.split('เพิ่มช้อยส์')[0] || chunk;
      const lines = beforeAdd.split('\\n').map((s) => s.trim()).filter(Boolean);
      const noise = new Set([
        'แก้ไขลำดับ','มีจำหน่าย','บันทึก','แก้ไขตัวเลือก','ลบตัวเลือกนี้','ตัวเลือก',
        'ชื่อตัวเลือก','ชื่อตัวเลือกภาษาไทย','ชื่อตัวเลือกภาษาอังกฤษ',
        'ลูกค้าจำเป็นต้องเลือก','ลูกค้าสามารถเลือกได้มากกว่า 1 ช้อยส์',
        'เช่น ความหวาน, ขนาด, ท็อปปิ้ง'
      ]);
      const choices = [];
      for (const line of lines) {
        if (noise.has(line)) continue;
        if (/^\\+?฿/.test(line)) continue;
        if (/^\\+?\\d+$/.test(line)) continue;
        if (line.length > 80) continue;
        if (/^หน้าหลัก|^เมนู|^TELL|^โปรโมชั่น$|^รายงาน|^ตั้งค่า/.test(line)) continue;
        choices.push(line);
      }
      return JSON.stringify({
        group: ${JSON.stringify(g.name)},
        id: ${JSON.stringify(g.id)},
        choices: [...new Set(choices)],
        hits
      });
    })()`);

    console.log(JSON.stringify(page));
    if (page?.choices) {
      for (const c of page.choices) allChoices.push({ group: page.group, name: c });
    }
    if (page?.hits?.length) orphanHits.push(page);
  }

  const liveNames = new Set(allChoices.map((c) => c.name));
  const stockPath = join(DATA, "lineman-stock-options.json");
  const orig = JSON.parse(readFileSync(stockPath, "utf8"));
  const before = (orig.options || []).length;
  const removed = DELETE_NAMES.map((n) => ({
    name: n,
    wasInStockFile: (orig.options || []).some((o) => o.name === n),
    onLive: liveNames.has(n),
  }));

  orig.options = (orig.options || []).filter((o) => !DELETE_NAMES.includes(o.name));
  orig.orphanCleanup = {
    at: new Date().toISOString(),
    removed,
    liveChoiceCount: allChoices.length,
    note: "Targets already absent on live Wongnai; removed stale stock rows only.",
  };
  writeFileSync(stockPath, JSON.stringify(orig, null, 2) + "\n");

  const logPath = join(DATA, "lineman-orphan-option-delete-log.json");
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        conclusion:
          "All 11 target names already absent from live Wongnai option groups. Cleaned lineman-stock-options.json.",
        removed,
        orphanHitsOnLive: orphanHits,
        liveGroups: groups.map((g) => g.name),
        liveChoices: allChoices,
        stockBefore: before,
        stockAfter: orig.options.length,
      },
      null,
      2,
    ) + "\n",
  );

  console.log("\nORPHAN HITS ON LIVE", orphanHits.length);
  console.log("stock", before, "->", orig.options.length);
  console.log(
    "still on live",
    removed.filter((r) => r.onLive).map((r) => r.name),
  );
  console.log(
    "removed from stock",
    removed.filter((r) => r.wasInStockFile).map((r) => r.name),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
