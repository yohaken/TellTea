/**
 * Live photo display gate — never claim ขึ้นจริง from a PUT/upload id alone.
 * Requires: live photo id, merchant-page <img> src, downloadable image bytes,
 * and aHash close to the confirmed POS main.
 */
import sharp from "sharp";

export const MIN_PX = 200;
export const MIN_BYTES = 2000;
export const MAX_AHASH_DISTANCE = 10;

export function liveIdInSrc(livePhotoId, srcs) {
  const id = String(livePhotoId || "").trim();
  if (!id) return false;
  const needle = id.replace(/^https?:/i, "").replace(/^\/\//, "").split("/").pop() || id;
  const compact = needle.replace(/\.(jpe?g|png|webp)$/i, "");
  const uuid = compact.match(/menueditor_item_([a-f0-9]{32})/i)?.[1] || "";
  return (Array.isArray(srcs) ? srcs : [srcs]).some((src) => {
    const s = String(src || "");
    return (
      s.includes(id) ||
      s.includes(needle) ||
      (compact.length > 12 && s.includes(compact)) ||
      (uuid.length === 32 && s.includes(uuid))
    );
  });
}

export function shopeeImageUrls(pictureId) {
  const id = String(pictureId || "").trim();
  if (!id) return [];
  return [
    `https://down-bs-th.img.susercontent.com/${id}`,
    `https://down-aka-th.img.susercontent.com/${id}`,
    `https://down-bs-th.img.susercontent.com/${id}.webp`,
    `https://down-aka-th.img.susercontent.com/${id}.webp`,
    `https://cf.shopee.co.th/file/${id}`,
  ];
}

export async function imageFingerprint(buf) {
  const { data } = await sharp(buf)
    .greyscale()
    .resize(8, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const v of data) sum += v;
  const avg = sum / data.length;
  let bits = 0n;
  for (let i = 0; i < data.length; i++) if (data[i] >= avg) bits |= 1n << BigInt(i);
  return bits.toString(16).padStart(16, "0");
}

export function fingerprintDistance(a, b) {
  if (!a || !b) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export async function inspectImageBytes(buf) {
  if (!buf || buf.length < 64) {
    return { ok: false, reason: "too-small", bytes: buf?.length || 0, width: 0, height: 0 };
  }
  try {
    const meta = await sharp(buf).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const ok = width >= MIN_PX && height >= MIN_PX;
    return {
      ok,
      reason: ok ? "" : "too-small-px",
      bytes: buf.length,
      width,
      height,
      format: meta.format || "",
    };
  } catch (e) {
    return { ok: false, reason: "not-image", bytes: buf.length, width: 0, height: 0, error: String(e.message || e) };
  }
}

export async function fetchPublicImage(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  let last = { ok: false, reason: "no-url" };
  for (const url of list.filter(Boolean)) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      const buf = Buffer.from(await res.arrayBuffer());
      const inspected = await inspectImageBytes(buf);
      last = { url, status: res.status, type: res.headers.get("content-type") || "", buf, ...inspected };
      if (res.status === 200 && inspected.ok) return last;
    } catch (e) {
      last = { url, ok: false, reason: "fetch-fail", error: String(e.message || e) };
    }
  }
  return last;
}

/**
 * @param {{
 *   posBuf: Buffer,
 *   livePhotoId: string,
 *   pageImgSrcs: string[],
 *   liveImageUrl?: string,
 *   extraUrls?: string[],
 * }} args
 */
export async function verifyDisplayedPhoto(args) {
  const reasons = [];
  const livePhotoId = String(args.livePhotoId || "").trim();
  if (!livePhotoId) reasons.push("no-live-id");
  const srcs = Array.isArray(args.pageImgSrcs) ? args.pageImgSrcs : [];
  if (!srcs.length) reasons.push("no-page-img");
  else if (livePhotoId && !liveIdInSrc(livePhotoId, srcs)) reasons.push("page-img-mismatch");

  const urls = [args.liveImageUrl, ...(args.extraUrls || []), ...srcs].filter(Boolean);
  let downloaded = urls.length ? await fetchPublicImage(urls) : { ok: false, reason: "no-cdn-url" };
  if ((!downloaded.ok || !downloaded.buf?.length) && args.downloadedBuf?.length) {
    const inspected = await inspectImageBytes(args.downloadedBuf);
    downloaded = {
      ...inspected,
      buf: args.downloadedBuf,
      url: args.liveImageUrl || downloaded.url || "",
    };
  }
  if (!downloaded.ok) reasons.push(`cdn:${downloaded.reason || downloaded.status || "fail"}`);

  let distance = null;
  let posFp = "";
  let liveFp = "";
  if (downloaded.ok && args.posBuf?.length && downloaded.buf?.length) {
    try {
      posFp = await imageFingerprint(args.posBuf);
      liveFp = await imageFingerprint(downloaded.buf);
      distance = fingerprintDistance(posFp, liveFp);
      if (distance > MAX_AHASH_DISTANCE) reasons.push(`looks-different:${distance}`);
    } catch (e) {
      reasons.push(`fingerprint:${String(e.message || e)}`);
    }
  } else if (!args.posBuf?.length) {
    reasons.push("no-pos-image");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    livePhotoId,
    pageImgSrcs: srcs.slice(0, 4),
    cdnUrl: downloaded.url || "",
    width: downloaded.width || 0,
    height: downloaded.height || 0,
    bytes: downloaded.bytes || downloaded.buf?.length || 0,
    distance,
    posFp,
    liveFp,
  };
}
