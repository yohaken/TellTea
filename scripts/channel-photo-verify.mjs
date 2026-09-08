#!/usr/bin/env node
/**
 * Inspect live displayed photos (API id + merchant <img> + CDN bytes + look vs POS).
 * Does not mark ขึ้นจริง from a push response alone.
 *
 *   node scripts/channel-photo-verify.mjs --pilot
 *   node scripts/channel-photo-verify.mjs --remaining --grab --write-hub
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { doc, getDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import {
  confirmDisplayedPhotoMatch,
  posBufFromItem,
  posMainHash,
} from "./lib/channel-photo-confirm.mjs";
import {
  isPhotoChannelVerified,
  loadFruitCoffeePhotoRows,
  loadMilkPhotoRows,
  loadSignatureDrinkPhotoRows,
  loadSmoothiePhotoRows,
  loadLightWavePhotoRows,
  loadFreshCoffeePhotoRows,
  loadFusionCoffeePhotoRows,
  loadHotCoffeePhotoRows,
  loadMatchaPhotoRows,
  loadBakeryPhotoRows,
  loadTeaWavePhotoRows,
} from "./lib/channel-photo-targets.mjs";

const PILOT = [
  {
    posId: "fs_item_33559286",
    name: "โกโก้ (เย็น/ปั่น)",
    dishId: "3246798564131840",
    grabId: "THITE2024040707225137437",
    lineId: "0leDVTV5lvQwH2AOlltbnXPhmz2MLE",
  },
  {
    posId: "fs_item_33559314",
    name: "ชานมไข่มุก (เย็น/ปั่น)",
    dishId: "2035915327775232",
    grabId: "THITE2024040710315731824",
    lineId: "0leDVTbnNIwwOK4o25HjFUvQRWneMh",
  },
];

async function main() {
  const remaining = process.argv.includes("--remaining");
  const tea = process.argv.includes("--tea");
  const fruit = process.argv.includes("--fruit");
  const milk = process.argv.includes("--milk");
  const smoothie = process.argv.includes("--smoothie");
  const light = process.argv.includes("--light");
  const fresh = process.argv.includes("--fresh");
  const fusion = process.argv.includes("--fusion");
  const hot = process.argv.includes("--hot");
  const matcha = process.argv.includes("--matcha");
  const bakery = process.argv.includes("--bakery");
  const namedCh =
    process.argv.includes("--shopee") ||
    process.argv.includes("--grab") ||
    process.argv.includes("--lineman");
  const allCh =
    process.argv.includes("--all") ||
    process.argv.includes("--pilot") ||
    ((remaining || tea || fruit || milk || smoothie || light || fresh || fusion || hot || matcha || bakery) && !namedCh);
  const want = {
    shopee: process.argv.includes("--shopee") || allCh,
    grab: process.argv.includes("--grab") || allCh,
    lineman: process.argv.includes("--lineman") || allCh,
  };
  if (!want.shopee && !want.grab && !want.lineman) {
    console.log("pass --pilot or --remaining or --tea or --fruit or --milk or --smoothie or --light or --fresh or --fusion or --hot or --matcha or --bakery [--shopee --grab --lineman]");
    return;
  }
  const writeHub = process.argv.includes("--write-hub");
  const db = await getSeedDb();
  const rows = bakery
    ? await loadBakeryPhotoRows(db)
    : matcha
      ? await loadMatchaPhotoRows(db)
      : hot
        ? await loadHotCoffeePhotoRows(db)
        : fusion
          ? await loadFusionCoffeePhotoRows(db)
          : fresh
            ? await loadFreshCoffeePhotoRows(db)
            : light
              ? await loadLightWavePhotoRows(db)
              : smoothie
                ? await loadSmoothiePhotoRows(db)
                : milk
                  ? await loadMilkPhotoRows(db)
                  : fruit
                    ? await loadFruitCoffeePhotoRows(db)
                    : tea
                      ? await loadTeaWavePhotoRows(db)
                      : remaining
                        ? await loadSignatureDrinkPhotoRows(db)
                        : PILOT;
  const log = [];
  for (const row of rows) {
    const item = (await getDoc(doc(db, "menuItems", row.posId))).data() || {};
    const posBuf = posBufFromItem(item);
    const posHash = posMainHash(item);
    const price = Number(item.price) || null;
    console.log(row.name);
    for (const channel of ["shopee", "grab", "lineman"]) {
      if (!want[channel]) continue;
      if ((remaining || tea || fruit || milk || smoothie || light || fresh || fusion || hot || matcha || bakery) && isPhotoChannelVerified(row.live?.[channel], posHash)) {
        console.log(`  ${channel} skip verified`);
        log.push({ name: row.name, posId: row.posId, channel, verify: { ok: true, skipped: true } });
        continue;
      }
      const result = await confirmDisplayedPhotoMatch({
        channel,
        row,
        posBuf,
        posHash,
        price,
        writeHub,
      });
      const v = result.verify || {};
      console.log(
        `  ${channel} ${result.ok ? "ok" : "FAIL"} id=${result.live?.livePhotoId || ""} ${v.width || 0}x${v.height || 0} d=${v.distance} ${result.ok ? "" : (v.reasons || []).join(",")}`,
      );
      log.push({
        name: row.name,
        posId: row.posId,
        channel,
        livePhotoId: result.live?.livePhotoId || "",
        pageImgSrcs: result.live?.pageImgSrcs || [],
        verify: v,
      });
    }
  }
  const out = join("scripts/data/menu-price-baseline", "channel-photo-verify-log.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), writeHub, remaining, tea, fruit, milk, smoothie, light, fresh, fusion, hot, matcha, bakery, log }, null, 2) + "\n");
  console.log(`→ ${out}`);
  process.exit(log.some((r) => !r.verify?.ok && !r.verify?.skipped) ? 1 : 0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
