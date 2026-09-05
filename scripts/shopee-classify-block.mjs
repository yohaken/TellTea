#!/usr/bin/env node
/**
 * Read Shopee edit pages (no save) and classify remaining off-target dishes:
 *   24h lock vs promo/phantom-promo (โกโก้-like) vs delay-only.
 *
 *   node scripts/shopee-classify-block.mjs
 *   node scripts/shopee-classify-block.mjs --write-notes
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findShopeeTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  editUrl,
  sleep,
} from "./lib/shopee-chrome.mjs";
import { writeMenuItemHubNote } from "./lib/hub-live-write.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");
const OUT = join(__dir, "data/menu-price-baseline/shopee-block-classify.json");
const WRITE_NOTES = process.argv.includes("--write-notes");
const H = 24 * 60 * 60 * 1000;
const NOTE_TAG = "S recreate";

function bkk(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classifyPopup(text) {
  const p = String(text || "");
  if (/24 ชั่วโมง|1 ครั้งใน/.test(p)) return "24h";
  if (/โปรโมชัน|โปรโมชั่น|promotion price/i.test(p)) return "promo";
  if (/ล่าช้า/.test(p)) return "delay";
  return "";
}

function uniqueShort(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const t = String(s || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length > 180) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

function readBlockSignals(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const body = document.body.innerText || "";
      const hits = [];
      for (const el of document.querySelectorAll("span, div, p, label, li, td, button")) {
        const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
        if (!t || t.length > 160) continue;
        if (/โปรโมชัน|โปรโมชั่น|ราคาโปร|promotion/i.test(t)) hits.push(t);
        if (/24 ชั่วโมง|1 ครั้ง/.test(t)) hits.push(t);
      }
      const uniq = [];
      const seen = {};
      for (const t of hits) {
        if (seen[t]) continue;
        seen[t] = 1;
        uniq.push(t);
        if (uniq.length >= 10) break;
      }
      return JSON.stringify({
        onEdit: location.href.includes("/edit"),
        href: location.href,
        hasPromoWord: /โปรโมชัน|โปรโมชั่น|ราคาโปร|promotion/i.test(body),
        has24hWord: /24 ชั่วโมง|1 ครั้งใน/.test(body),
        hits: uniq,
      });
    })()`,
    { windowIndex },
  );
}

async function main() {
  const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
  const now = Date.now();
  const pending = Object.values(tracker.items || {}).filter(
    (i) => i.currentLive !== i.targetPrice && i.dishId,
  );

  const { windowIndex, tabIndex } = findShopeeTab();
  console.log(`=== classify ${pending.length} off-target · tab ${tabIndex} ===`);

  const rows = [];
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.dishId)}'; return 'ok'; })()`, {
      windowIndex,
    });
    await sleep(1800);
    let sig = readBlockSignals(tabIndex, windowIndex);
    if (!sig?.onEdit) {
      await sleep(1200);
      sig = readBlockSignals(tabIndex, windowIndex);
    }

    const rounds = item.rounds || [];
    const lastOk = [...rounds].reverse().find((r) => r.changed && r.verified !== false);
    const lastOkAt = lastOk?.at ? Date.parse(lastOk.at) : null;
    const in24h = lastOkAt != null && now - lastOkAt < H;
    const everPromo = rounds.some(
      (r) => r.status === "blocked_promo" || /โปรโมชัน|โปรโมชั่น/.test(r.popupText || ""),
    );
    const lastPopupKind = classifyPopup(rounds.at(-1)?.popupText || "") || rounds.at(-1)?.status || "";
    const pagePromo = !!(sig?.hasPromoWord || (sig?.hits || []).some((h) => /โปรโมชัน|โปรโมชั่น|ราคาโปร|promotion/i.test(h)));
    const page24h = !!(sig?.has24hWord || (sig?.hits || []).some((h) => /24 ชั่วโมง/.test(h)));

    let kind = "delay";
    if (in24h || page24h) kind = "24h";
    else if (pagePromo || everPromo) kind = "promo";

    const row = {
      name: item.name,
      dishId: String(item.dishId),
      posId: item.posId || null,
      live: item.currentLive,
      target: item.targetPrice,
      kind,
      in24h,
      everPromo,
      lastOk: lastOk?.at || null,
      lastOkBkk: bkk(lastOk?.at),
      lastPopupKind,
      pagePromo,
      page24h,
      pageHits: uniqueShort(sig?.hits || []),
      onEdit: !!sig?.onEdit,
    };
    rows.push(row);
    console.log(
      `[${i + 1}/${pending.length}] ${kind.padEnd(6)} ${item.currentLive}→${item.targetPrice} ${item.name} pagePromo=${pagePromo} everPromo=${everPromo} in24h=${in24h}`,
    );
    if (row.pageHits.length) console.log(`  ui: ${row.pageHits.slice(0, 3).join(" · ")}`);
    await sleep(400);
  }

  const byKind = { promo: [], "24h": [], delay: [] };
  for (const r of rows) byKind[r.kind]?.push(r);

  const plan = {
    at: new Date().toISOString(),
    noteTag: NOTE_TAG,
    cocoaLike:
      "หน้าแก้หรือประวัติขึ้น «ราคาต้องมากกว่าโปรโมชัน» แม้ในรายการโปรอาจว่าง — บั๊ก/โปรค้างที่เมนู",
    counts: {
      promo: byKind.promo.length,
      "24h": byKind["24h"].length,
      delay: byKind.delay.length,
    },
    recreateCandidates: byKind.promo,
    wait24h: byKind["24h"],
    delayUnknown: byKind.delay,
    all: rows,
  };
  writeFileSync(OUT, JSON.stringify(plan, null, 2) + "\n");
  console.log(`\npromo/recreate ${byKind.promo.length} · 24h ${byKind["24h"].length} · delay ${byKind.delay.length}`);
  console.log(`→ ${OUT}`);

  if (WRITE_NOTES) {
    let n = 0;
    for (const r of byKind.promo) {
      if (!r.posId) continue;
      const note =
        `${NOTE_TAG} Shopee · phantom-promo แบบโกโก้ · ${r.live}→${r.target}` +
        ` · dish ${r.dishId} · ลบแล้วสร้างใหม่ (ยังไม่ทำ) · ${bkk(plan.at)}`;
      const ok = await writeMenuItemHubNote(r.posId, note);
      if (ok) {
        n += 1;
        console.log(`  note ${r.name}`);
      }
    }
    for (const r of byKind["24h"]) {
      if (!r.posId) continue;
      const until = r.lastOk ? new Date(Date.parse(r.lastOk) + H).toISOString() : "";
      const note = `S ⏳24h ${r.live}→${r.target} ปลด~${bkk(until)} · ไม่ใช่โปร · ${bkk(plan.at)}`;
      const ok = await writeMenuItemHubNote(r.posId, note);
      if (ok) n += 1;
    }
    console.log(`wrote hubNote ${n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
