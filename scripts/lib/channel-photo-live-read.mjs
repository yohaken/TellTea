/**
 * Read live photo id + the <img> actually shown on the merchant edit page.
 */
import {
  assertShopeeLoggedIn,
  chromeJsJsonOnTab as sJs,
  chromeJsOnTab as sOn,
  editUrl as sEdit,
  findShopeeTab,
  sleep,
} from "./shopee-chrome.mjs";
import {
  chromeJsJsonOnTab as gJs,
  chromeJsOnTab as gOn,
  fetchGrabMenuApi,
  findGrabTab,
  openEditItem as openGrabEdit,
  sleep as gSleep,
} from "./grab-chrome.mjs";
import {
  chromeJsJsonOnTab as wJs,
  editUrl as wEdit,
  findWongnaiTab,
  openEditItem as openLineEdit,
  readWongnaiMenuItem,
} from "./lineman-chrome.mjs";
import { shopeeImageUrls, liveIdInSrc } from "./channel-photo-verify.mjs";

function grabPhotoId(url) {
  const m = String(url || "").match(/menueditor_item_[a-z0-9_]+(?:\.(?:jpe?g|png|webp))?/i);
  return m ? m[0] : String(url || "");
}

async function fetchImageBufOnGrabTab(tabIndex, windowIndex, url) {
  const key = `__ttImg_${Date.now()}`;
  gOn(
    tabIndex,
    `(() => {
      window[${JSON.stringify(key)}] = 'pending';
      fetch(${JSON.stringify(url)}, { credentials: 'include' }).then(async (r) => {
        const buf = new Uint8Array(await r.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        window[${JSON.stringify(key)}] = { status: r.status, b64: btoa(s) };
      }).catch((e) => { window[${JSON.stringify(key)}] = { error: String(e) }; });
      return 'started';
    })()`,
    { windowIndex },
  );
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await gSleep(300);
    const st = gJs(
      tabIndex,
      `(() => {
        const x = window[${JSON.stringify(key)}];
        if (x == null || x === 'pending') return JSON.stringify(x);
        return JSON.stringify({ status: x.status, len: (x.b64 || '').length, error: x.error || '', ready: true });
      })()`,
      { windowIndex },
    );
    if (st && st !== "pending" && st.ready) {
      if (st.status === 200 && st.len > 1000) {
        const b64 = gOn(tabIndex, `(() => window[${JSON.stringify(key)}].b64 || '')()`, { windowIndex });
        if (b64 && b64.length > 1000) return Buffer.from(b64, "base64");
      }
      return null;
    }
  }
  return null;
}

function linePhotoId(url) {
  const raw = String(url || "");
  const abs = raw.startsWith("//") ? `https:${raw}` : raw;
  const m = abs.match(/\/([^/?]+)(?:\?|$)/);
  return { id: m ? m[1] : abs, url: abs };
}

export async function readShopeeLiveDisplay(dishId, tab) {
  const { windowIndex, tabIndex } = tab?.tabIndex != null ? tab : findShopeeTab();
  assertShopeeLoggedIn(tabIndex, windowIndex);
  const dish = sJs(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', 'https://foody.shopee.co.th/api/seller/store/dishes/${dishId}', false);
      x.withCredentials = true;
      x.send(null);
      let json = null;
      try { json = JSON.parse(x.responseText); } catch {}
      const d = json?.data?.dish || {};
      return JSON.stringify({
        ok: json?.code === 0 && d.id != null,
        picture: d.picture || '',
        available: d.available,
        listing_status: d.listing_status,
      });
    })()`,
    { windowIndex },
  );
  sOn(tabIndex, `(() => { location.href=${JSON.stringify(sEdit(dishId))}; return 'ok'; })()`, {
    windowIndex,
  });
  let page = { url: "", imgs: [] };
  for (let i = 0; i < 10; i++) {
    await sleep(i === 0 ? 2200 : 700);
    page = sJs(
      tabIndex,
      `(() => JSON.stringify({
        url: location.href,
        imgs: [...document.querySelectorAll('img')].flatMap((i) => [i.src, i.currentSrc, i.getAttribute('src')]).filter((s) => /susercontent|th-11134505|preview|blob:/.test(s||'')),
      }))()`,
      { windowIndex },
    ) || { url: "", imgs: [] };
    if ((page.imgs || []).length && String(page.url || "").includes(String(dishId))) break;
  }
  const picture = dish?.picture || "";
  return {
    channel: "shopee",
    livePhotoId: picture,
    liveImageUrl: shopeeImageUrls(picture)[0] || "",
    extraUrls: shopeeImageUrls(picture),
    pageImgSrcs: page?.imgs || [],
    available: dish?.available,
    pageUrl: page?.url || "",
  };
}

export async function readGrabLiveDisplay(itemId, name, category = "", tab) {
  const { windowIndex, tabIndex } = tab?.tabIndex != null ? tab : findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  const it = (menu.categories || [])
    .flatMap((c) => c.items || [])
    .find((row) => row.itemID === itemId);
  await openGrabEdit(tabIndex, itemId, name, windowIndex, category);
  const imageURL = it?.imageURL || "";
  const livePhotoId = grabPhotoId(imageURL);
  let page = { url: "", imgs: [] };
  for (let i = 0; i < 10; i++) {
    await gSleep(i === 0 ? 1200 : 600);
    page = gJs(
      tabIndex,
      `(() => JSON.stringify({
        url: location.href,
        imgs: (() => {
          const all = [...document.querySelectorAll('img')].map((el) => el.src).filter(Boolean);
          const mine = all.filter((s) => s.includes(${JSON.stringify(itemId)}));
          return (mine.length ? mine : all.filter((s) => /menueditor_item|food-cms/.test(s))).slice(0, 8);
        })(),
      }))()`,
      { windowIndex },
    ) || { url: "", imgs: [] };
    if ((page.imgs || []).length && liveIdInSrc(livePhotoId, page.imgs)) break;
  }
  let downloadedBuf = null;
  if (imageURL) {
    downloadedBuf = await fetchImageBufOnGrabTab(tabIndex, windowIndex, imageURL);
  }
  return {
    channel: "grab",
    livePhotoId,
    liveImageUrl: imageURL,
    extraUrls: page?.imgs || [],
    pageImgSrcs: [...new Set([imageURL, ...(page?.imgs || [])].filter(Boolean))],
    downloadedBuf,
    available: it?.availableStatus,
    pageUrl: page?.url || "",
  };
}

export async function readLineLiveDisplay(lineId, name, tab) {
  const found = tab?.tabIndex != null ? tab : findWongnaiTab();
  const { windowIndex, tabIndex } = found;
  const live = await readWongnaiMenuItem(lineId, found);
  await openLineEdit(tabIndex, lineId, name, windowIndex, wEdit(lineId));
  await sleep(800);
  const ui = wJs(
    tabIndex,
    `(() => JSON.stringify({
      url: location.href,
      imgs: [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => /lmwn|line-scdn|blob:/.test(s||'')).slice(0, 4),
    }))()`,
    { windowIndex },
  );
  const parsed = linePhotoId(live.photoId || "");
  return {
    channel: "lineman",
    livePhotoId: parsed.id,
    liveImageUrl: parsed.url,
    extraUrls: [],
    pageImgSrcs: ui?.imgs || [],
    available: live.status,
    pageUrl: ui?.url || "",
  };
}
