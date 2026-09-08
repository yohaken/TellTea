/**
 * After a photo push (or a re-check): download CDN + page <img> + aHash vs POS.
 * Writes hub photo_match only when the displayed image is confirmed.
 */
import { verifyDisplayedPhoto } from "./channel-photo-verify.mjs";
import { writeHubChannelLiveRow } from "./hub-live-write.mjs";
import {
  readGrabLiveDisplay,
  readLineLiveDisplay,
  readShopeeLiveDisplay,
} from "./channel-photo-live-read.mjs";

export function posBufFromItem(item) {
  const raw = String(item?.imageUrl || "");
  if (!raw.startsWith("data:")) return null;
  return Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
}

export function posMainHash(item) {
  const existing = String(item?.imageHash || "").trim();
  if (existing) return existing;
  const raw = String(item?.imageUrl || "").trim();
  if (!raw) return "";
  const payload = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= payload.length;
  return `${(h >>> 0).toString(16).padStart(8, "0")}:${payload.length.toString(16)}`;
}

export function channelLetter(channel) {
  if (channel === "shopee") return "S";
  if (channel === "grab") return "G";
  return "L";
}

export function externalIdFor(channel, row) {
  if (channel === "shopee") return row.dishId;
  if (channel === "grab") return row.grabId;
  return row.lineId;
}

export async function readLiveDisplay(channel, row, tab) {
  if (channel === "shopee") return readShopeeLiveDisplay(row.dishId, tab);
  if (channel === "grab") return readGrabLiveDisplay(row.grabId, row.name, row.category || "", tab);
  return readLineLiveDisplay(row.lineId, row.name, tab);
}

/**
 * @param {{
 *   channel: 'shopee' | 'grab' | 'lineman',
 *   row: { posId: string, name: string, dishId?: string, grabId?: string, lineId?: string },
 *   posBuf: Buffer | null,
 *   posHash: string,
 *   price: number | null,
 *   writeHub?: boolean,
 *   tab?: { tabIndex: number, windowIndex: number },
 * }} args
 */
export async function confirmDisplayedPhotoMatch(args) {
  const { channel, row, posBuf, posHash, price } = args;
  const writeHub = args.writeHub !== false;
  const live = await readLiveDisplay(channel, row, args.tab);
  let verify;
  try {
    verify = await verifyDisplayedPhoto({ posBuf, ...live });
  } catch (e) {
    verify = { ok: false, reasons: [`verify-throw:${String(e.message || e)}`] };
  }
  const letter = channelLetter(channel);
  const at = new Date().toISOString();
  if (writeHub) {
    if (verify.ok) {
      await writeHubChannelLiveRow({
        posId: row.posId,
        channel,
        name: row.name,
        price,
        externalId: externalIdFor(channel, row),
        photoId: live.livePhotoId,
        photoPushedId: live.livePhotoId,
        photoPushedHash: posHash,
        photoPushedAt: at,
        photoVerifiedAt: at,
        source: "apply",
        applyStatus: "photo_match",
        applyNote: `${letter} รูป ✓ · ตรวจไฟล์แล้ว d=${verify.distance}`,
      });
    } else {
      // Still record the live id as pushed so hub does not stay "stale"
      // against an older photoPushedId after a successful upload.
      const liveId = live.livePhotoId || "";
      await writeHubChannelLiveRow({
        posId: row.posId,
        channel,
        name: row.name,
        price,
        externalId: externalIdFor(channel, row),
        photoId: liveId,
        ...(liveId
          ? {
              photoPushedId: liveId,
              photoPushedHash: posHash,
              photoPushedAt: at,
            }
          : {}),
        source: "apply",
        applyStatus: "photo_pending",
        applyNote: `${letter} ตรวจไฟล์ไม่ผ่าน ${(verify.reasons || []).join(",")}`,
      });
    }
  }
  return { ok: verify.ok, channel, live, verify };
}
