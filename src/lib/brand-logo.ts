import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { isEvidencePhotoRef, resolveEvidencePhotoSrc } from "./evidence-photos";

/** Soft cap — brand marks must stay tiny so AppShell stays snappy. */
export const BRAND_LOGO_MAX_CHARS = 80_000;

export const BRAND_LOGO_CHANGED_EVENT = "telltea-brand-logo";
/** Legacy key that once held full data URLs and froze mobile Safari. */
export const BRAND_LOGO_LEGACY_STORAGE_KEY = "telltea-brand-logo-v1";

type BrandLogoDoc = {
  dataUrl: string;
  updatedAt: number;
  updatedBy: string;
};

let memorySrc = "";
let loadPromise: Promise<string> | null = null;

function brandLogoRef() {
  return doc(getDb(), "meta", "brandLogo");
}

function profileRef() {
  return doc(getDb(), "meta", "businessProfile");
}

export function getBrandLogoMemory() {
  return memorySrc;
}

/** Clear toxic oversized localStorage from the previous build. */
export function purgeLegacyBrandLogoStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BRAND_LOGO_LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Update in-memory logo. Only emits when value actually changes
 * (prevents AppBrand ↔ cache event loops that froze the app).
 */
export function setBrandLogoMemory(src: string, emit = true) {
  const next = String(src || "").trim();
  if (next === memorySrc) return;
  memorySrc = next;
  if (emit && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BRAND_LOGO_CHANGED_EVENT, { detail: next }));
  }
}

async function shrinkDataUrlIfNeeded(dataUrl: string, maxChars = BRAND_LOGO_MAX_CHARS): Promise<string> {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/") || raw.length <= maxChars) return raw;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("อ่านโลโก้ไม่สำเร็จ"));
    el.src = raw;
  });

  let edge = Math.min(320, Math.max(img.naturalWidth || 320, img.naturalHeight || 320));
  while (edge >= 96) {
    const scale = Math.min(1, edge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || edge) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || edge) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const isPng = raw.startsWith("data:image/png");
    const next = canvas.toDataURL(isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.82);
    if (next.length <= maxChars) return next;
    edge = Math.round(edge * 0.75);
  }
  throw new Error("โลโก้ใหญ่เกินไป — ลดขนาด PNG แล้วลองใหม่");
}

export async function saveBrandLogo(dataUrl: string, updatedBy: string): Promise<string> {
  const shrunk = dataUrl.trim()
    ? await shrinkDataUrlIfNeeded(dataUrl.trim())
    : "";
  const payload: BrandLogoDoc = {
    dataUrl: shrunk,
    updatedAt: Date.now(),
    updatedBy,
  };
  await setDoc(brandLogoRef(), payload, { merge: true });
  // Keep businessProfile lean — never store image bytes there again.
  await setDoc(profileRef(), { logoUrl: shrunk ? "brandLogo" : "", updatedAt: Date.now(), updatedBy }, { merge: true });
  setBrandLogoMemory(shrunk, true);
  loadPromise = Promise.resolve(shrunk);
  return shrunk;
}

/**
 * Load brand logo once per session. Safe on login (meta/brandLogo is public-read).
 * Migrates fat data URLs left on businessProfile by the previous build.
 */
export async function loadBrandLogo(): Promise<string> {
  if (memorySrc) return memorySrc;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    purgeLegacyBrandLogoStorage();
    try {
      const snap = await getDoc(brandLogoRef());
      let src = snap.exists() ? String((snap.data() as BrandLogoDoc)?.dataUrl || "").trim() : "";

      if (!src) {
        const profileSnap = await getDoc(profileRef());
        const legacy = profileSnap.exists()
          ? String((profileSnap.data() as { logoUrl?: string })?.logoUrl || "").trim()
          : "";
        if (legacy.startsWith("data:image/")) {
          try {
            src = await shrinkDataUrlIfNeeded(legacy);
            await setDoc(
              brandLogoRef(),
              { dataUrl: src, updatedAt: Date.now(), updatedBy: "migrate" } satisfies BrandLogoDoc,
              { merge: true },
            );
          } catch {
            src = "";
          }
          await setDoc(profileRef(), { logoUrl: src ? "brandLogo" : "" }, { merge: true });
        } else if (isEvidencePhotoRef(legacy)) {
          try {
            const resolved = await resolveEvidencePhotoSrc(legacy);
            src = resolved.startsWith("data:") ? await shrinkDataUrlIfNeeded(resolved) : "";
            if (src) {
              await setDoc(
                brandLogoRef(),
                { dataUrl: src, updatedAt: Date.now(), updatedBy: "migrate" } satisfies BrandLogoDoc,
                { merge: true },
              );
              await setDoc(profileRef(), { logoUrl: "brandLogo" }, { merge: true });
            }
          } catch {
            src = "";
          }
        } else if (/^https?:\/\//i.test(legacy)) {
          src = legacy;
        }
      } else if (src.length > BRAND_LOGO_MAX_CHARS) {
        try {
          src = await shrinkDataUrlIfNeeded(src);
          await setDoc(
            brandLogoRef(),
            { dataUrl: src, updatedAt: Date.now(), updatedBy: "shrink" } satisfies BrandLogoDoc,
            { merge: true },
          );
        } catch {
          src = "";
        }
      }

      setBrandLogoMemory(src, false);
      return memorySrc;
    } catch {
      setBrandLogoMemory("", false);
      return "";
    }
  })();

  return loadPromise;
}
