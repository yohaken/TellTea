/**
 * Photo-sync targets from POS + hub live IDs.
 */
import { collection, getDocs } from "firebase/firestore";
import { loadHubChannelLiveItems } from "./hub-live-write.mjs";

export const SIGNATURE_DRINKS_CAT = "Signature Drinks เย็น/ปั่น";

export const TEA_WAVE_CATS = [
  "ชานมสดคราฟต์ เย็น/ปั่น",
  "ชา",
  "ชานม เย็น/ปั่น",
];

export const FRUIT_COFFEE_CATS = ["ชาผลไม้", "กาแฟ เย็น/ปั่น"];

export const MILK_CATS = ["นม เย็น/ปั่น"];

export const SMOOTHIE_CATS = ["ผลไม้ปั่น & สมูทตี้"];

export const LIGHT_WAVE_CATS = [
  "เบาเบากับน้ำเต้าหู้ เย็น/ปั่น",
  "อิตาเลียน โซดา",
  "0% แคล ชาเพื่อสุขภาพ",
  "0% แคล โซดาซ่าเพื่อสุขภาพ",
];

export const FRESH_COFFEE_CATS = ["* กาแฟสดเข้มข้น", "* กาแฟสดนมนุ่มละมุน"];

export const FUSION_COFFEE_CATS = ["* กาแฟสดฟิวชันสดชื่น"];

export const HOT_COFFEE_CATS = ["* กาแฟสด อื่นๆ ร้อน"];

export const MATCHA_CATS = ["มัจฉะแท้"];

export const BAKERY_CATS = ["เบเกอรี่ & ไอศครีม"];

function normalizeChannelPhotoId(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const base = u.pathname.split("/").filter(Boolean).pop() || "";
      return decodeURIComponent(base);
    }
  } catch {
    /* fall through */
  }
  const m = s.match(/\/([^/?#]+)(?:\?|#|$)/);
  return m ? decodeURIComponent(m[1]) : s;
}

export function isPhotoChannelVerified(obs, posHash) {
  if (!obs?.photoVerifiedAt || !obs.photoPushedId || !obs.photoPushedHash) return false;
  if (String(obs.photoPushedHash) !== String(posHash || "")) return false;
  if (obs.photoId) {
    const live = normalizeChannelPhotoId(obs.photoId);
    const pushed = normalizeChannelPhotoId(obs.photoPushedId);
    if (live && pushed && live !== pushed) return false;
  }
  return true;
}

export async function loadPhotoRows(db, categoryNames) {
  const want = new Set(categoryNames);
  const [catsSnap, itemsSnap, liveItems] = await Promise.all([
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuItems")),
    loadHubChannelLiveItems(),
  ]);
  const catName = new Map();
  for (const d of catsSnap.docs) catName.set(d.id, d.data()?.name || "");
  const rows = [];
  for (const d of itemsSnap.docs) {
    const it = d.data() || {};
    if (it.active === false || it.storeOnly) continue;
    const category = catName.get(it.categoryId || "") || "";
    if (!want.has(category)) continue;
    const live = liveItems[d.id] || {};
    rows.push({
      posId: d.id,
      name: it.name || "",
      category,
      dishId: live.shopee?.externalId || "",
      grabId: live.grab?.externalId || "",
      lineId: live.lineman?.externalId || "",
      sort: Number(it.sortOrder) || 0,
      live,
    });
  }
  const catRank = new Map(categoryNames.map((n, i) => [n, i]));
  rows.sort(
    (a, b) =>
      (catRank.get(a.category) ?? 99) - (catRank.get(b.category) ?? 99) ||
      a.sort - b.sort ||
      a.name.localeCompare(b.name, "th"),
  );
  return rows;
}

export async function loadSignatureDrinkPhotoRows(db) {
  return loadPhotoRows(db, [SIGNATURE_DRINKS_CAT]);
}

export async function loadTeaWavePhotoRows(db) {
  return loadPhotoRows(db, TEA_WAVE_CATS);
}

export async function loadFruitCoffeePhotoRows(db) {
  return loadPhotoRows(db, FRUIT_COFFEE_CATS);
}

export async function loadMilkPhotoRows(db) {
  return loadPhotoRows(db, MILK_CATS);
}

export async function loadSmoothiePhotoRows(db) {
  return loadPhotoRows(db, SMOOTHIE_CATS);
}

export async function loadLightWavePhotoRows(db) {
  return loadPhotoRows(db, LIGHT_WAVE_CATS);
}

export async function loadFreshCoffeePhotoRows(db) {
  return loadPhotoRows(db, FRESH_COFFEE_CATS);
}

export async function loadFusionCoffeePhotoRows(db) {
  return loadPhotoRows(db, FUSION_COFFEE_CATS);
}

export async function loadHotCoffeePhotoRows(db) {
  return loadPhotoRows(db, HOT_COFFEE_CATS);
}

export async function loadMatchaPhotoRows(db) {
  return loadPhotoRows(db, MATCHA_CATS);
}

export async function loadBakeryPhotoRows(db) {
  return loadPhotoRows(db, BAKERY_CATS);
}
