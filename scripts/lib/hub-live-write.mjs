/**
 * Write one channel live observation into menuPriceHub/channelLive (row-by-row).
 * Safe for parallel workers: serialized queue + Firestore map merge.
 */
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getSeedDb } from "./pos-firebase-seed.mjs";

/** @type {Promise<import('firebase/firestore').Firestore> | null} */
let dbPromise = null;
/** @type {Promise<void>} */
let chain = Promise.resolve();

function getDb() {
  if (!dbPromise) dbPromise = getSeedDb();
  return dbPromise;
}

/** @returns {Promise<Record<string, Record<string, object>>>} */
export async function loadHubChannelLiveItems() {
  const db = await getDb();
  const snap = await getDoc(doc(db, "menuPriceHub", "channelLive"));
  if (!snap.exists()) return {};
  const items = snap.data()?.items;
  return items && typeof items === "object" ? items : {};
}

/**
 * @param {{
 *   posId: string,
 *   channel: 'shopee' | 'grab' | 'lineman',
 *   name?: string,
 *   price: number | null,
 *   scannedAt?: string | null,
 *   externalId?: string | null,
 *   source?: string,
 *   targetPrice?: number | null,
 *   applyStatus?: string | null,
 *   applyNote?: string | null,
 *   cooldownUntil?: string | null,
 *   scope?: 'item' | 'option',
 * }} row
 */
export function writeHubChannelLiveRow(row) {
  const posId = row?.posId;
  const channel = row?.channel;
  if (!posId || !channel) return Promise.resolve(false);
  const price =
    row.price == null || !Number.isFinite(Number(row.price)) || Number(row.price) < 0
      ? null
      : Number(row.price);
  // still allow writing name-only? prefer skip empty
  if (price == null && !(row.name || "").trim()) return Promise.resolve(false);

  const observation = {
    name: row.name || "",
    price,
    scannedAt: row.scannedAt || new Date().toISOString(),
    source: row.source || "apply",
    externalId: row.externalId != null ? String(row.externalId) : null,
  };
  if (row.targetPrice != null && Number.isFinite(Number(row.targetPrice))) {
    observation.targetPrice = Number(row.targetPrice);
  }
  if (row.applyStatus) observation.applyStatus = String(row.applyStatus);
  if (row.applyNote) observation.applyNote = String(row.applyNote);
  if (row.cooldownUntil) observation.cooldownUntil = String(row.cooldownUntil);

  const bucket = row.scope === "option" ? "options" : "items";

  const job = chain.then(async () => {
    const db = await getDb();
    const ref = doc(db, "menuPriceHub", "channelLive");
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : { items: {}, options: {}, unmatched: [] };
    const items = { ...(data.items || {}) };
    const options = { ...(data.options || {}) };
    const unmatched = Array.isArray(data.unmatched) ? data.unmatched : [];
    const bucketMap = bucket === "options" ? options : items;
    const row = { ...(bucketMap[posId] || {}) };
    const prev = row[channel] || {};
    const merged = { ...observation };
    if (merged.sortIndex == null && prev.sortIndex != null) merged.sortIndex = prev.sortIndex;
    if (!(merged.category || "").trim() && prev.category) merged.category = prev.category;
    if ((!merged.groupNames || !merged.groupNames.length) && prev.groupNames?.length) {
      merged.groupNames = prev.groupNames;
    }
    if (merged.choiceIndex == null && prev.choiceIndex != null) merged.choiceIndex = prev.choiceIndex;
    row[channel] = merged;
    bucketMap[posId] = row;
    // Full-doc write so sibling channels (Grab / LINE MAN) are never replaced.
    await setDoc(ref, {
      items,
      options,
      unmatched,
      updatedAt: Date.now(),
    });
    return true;
  });
  chain = job.then(
    () => undefined,
    () => undefined,
  );
  return job.catch((err) => {
    console.warn(`hub live write fail ${channel} ${posId}:`, err?.message || err);
    return false;
  });
}

/** @param {string} posId @param {string | null | undefined} note */
export function writeMenuItemHubNote(posId, note) {
  if (!posId) return Promise.resolve(false);
  const raw = note == null ? "" : String(note).trim();
  const job = chain.then(async () => {
    const db = await getDb();
    await updateDoc(doc(db, "menuItems", posId), {
      hubNote: raw || null,
      updatedAt: Date.now(),
    });
    return true;
  });
  chain = job.then(
    () => undefined,
    () => undefined,
  );
  return job.catch((err) => {
    console.warn(`hubNote write fail ${posId}:`, err?.message || err);
    return false;
  });
}

const SHOPEE_TABLE_NOTE_MARKER = "Shopee price pipeline";

/** Append Shopee apply playbook to menuPriceHub/settings.tableNote if missing. */
export async function ensureShopeePipelineTableNote() {
  const block = [
    SHOPEE_TABLE_NOTE_MARKER,
    "· เป้า = POS หน้าร้าน + สูตร Shopee (GP/%) · step สูงสุด 15%/save",
    "· Shopee จำกัด 1 ครั้ง/24h ต่อเมนู — คิวข้ามรายการ cooldown อัตโนมัติ",
    "· หลัง apply: เขียน hub live + hubNote + scannedAt ทันที (แม้ยังไม่ถึงเป้า)",
    "· รันซ้ำ: ทำแถวที่ hub scannedAt เก่าที่สุด / ยังไม่เคย apply ก่อน",
    "· สคริปต์: node scripts/shopee-chrome-batch-update.mjs --apply --limit=20",
    "· backfill: node scripts/shopee-sync-hub-from-tracker.mjs",
  ].join("\n");

  const db = await getDb();
  const ref = doc(db, "menuPriceHub", "settings");
  const snap = await getDoc(ref);
  const prev = snap.exists() ? String(snap.data()?.tableNote || "") : "";
  if (prev.includes(SHOPEE_TABLE_NOTE_MARKER)) return false;
  const next = prev.trim() ? `${prev.trim()}\n\n${block}` : block;
  await setDoc(ref, { tableNote: next, updatedAt: Date.now() }, { merge: true });
  return true;
}

/**
 * From apply/verify result → hub row (uses verifyRead/after/before).
 * @param {'shopee' | 'grab' | 'lineman'} channel
 * @param {object} result
 */
export function writeHubLiveFromApplyResult(channel, result) {
  const posId = result?.posId;
  if (!posId) return Promise.resolve(false);
  const verifyRead = Number(result.verifyRead);
  const after = Number(result.after);
  const before = Number(result.before);
  const price = Number.isFinite(verifyRead)
    ? verifyRead
    : Number.isFinite(after) && after > 0
      ? after
      : Number.isFinite(before) && before > 0
        ? before
        : null;
  if (price == null) return Promise.resolve(false);
  const ext =
    result.dishId != null
      ? String(result.dishId)
      : result.itemId != null
        ? String(result.itemId)
        : result.externalId != null
          ? String(result.externalId)
          : null;
  return writeHubChannelLiveRow({
    posId,
    channel,
    name: result.name || result.posName || "",
    price,
    scannedAt: result.at || new Date().toISOString(),
    externalId: ext,
    source: "apply",
    targetPrice: Number.isFinite(Number(result.target)) ? Number(result.target) : result.targetPrice,
    applyStatus: result.status || result.applyStatus || null,
    applyNote: result.applyNote || result.hubNote || null,
    cooldownUntil: result.cooldownUntil || null,
  });
}
