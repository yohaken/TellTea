import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { isEvidencePhotoRef, resolveEvidencePhotoSrc } from "./evidence-photos";
import { prepareBrandLogoPngDataUrl } from "./receipts";

/** Soft cap — brand marks must stay tiny so AppShell stays snappy. */
export const BRAND_LOGO_MAX_CHARS = 80_000;

export const BRAND_LOGO_CHANGED_EVENT = "telltea-brand-logo";
/** Legacy key that once held full data URLs and froze mobile Safari. */
export const BRAND_LOGO_LEGACY_STORAGE_KEY = "telltea-brand-logo-v1";

type BrandLogoDoc = {
  dataUrl: string;
  updatedAt: number;
  updatedBy: string;
  /** Light edge pad knocked out → transparent PNG (no white corners on login). */
  lightBgKnockedOut?: boolean;
};

let memorySrc = "";
let loadPromise: Promise<string> | null = null;
/** Bumped on every save/clear so in-flight loads cannot overwrite a newer upload. */
let logoEpoch = 0;

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

async function shrinkPngDataUrlIfNeeded(
  dataUrl: string,
  maxChars = BRAND_LOGO_MAX_CHARS,
): Promise<string> {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/") || raw.length <= maxChars) return raw;

  let edge = 280;
  while (edge >= 96) {
    const next = await prepareBrandLogoPngDataUrl(raw, edge);
    if (next.length <= maxChars) return next;
    edge = Math.round(edge * 0.75);
  }
  throw new Error("โลโก้ใหญ่เกินไป — ลดขนาด PNG แล้วลองใหม่");
}

/** Knock out light pad + shrink — always stores transparent PNG. */
async function prepareAndShrinkLogo(dataUrl: string): Promise<string> {
  const punched = await prepareBrandLogoPngDataUrl(dataUrl.trim(), 320);
  return shrinkPngDataUrlIfNeeded(punched);
}

export async function saveBrandLogo(dataUrl: string, updatedBy: string): Promise<string> {
  // Invalidate any in-flight loadBrandLogo before awaiting encode/network.
  logoEpoch += 1;
  const epoch = logoEpoch;

  const shrunk = dataUrl.trim() ? await prepareAndShrinkLogo(dataUrl.trim()) : "";
  if (epoch !== logoEpoch) {
    // A newer save started while we were encoding — prefer the newer memory.
    return memorySrc;
  }

  const payload: BrandLogoDoc = {
    dataUrl: shrunk,
    updatedAt: Date.now(),
    updatedBy,
    lightBgKnockedOut: Boolean(shrunk),
  };
  await setDoc(brandLogoRef(), payload, { merge: true });
  if (epoch !== logoEpoch) return memorySrc;

  // Keep businessProfile lean — never store image bytes there again.
  await setDoc(
    profileRef(),
    { logoUrl: shrunk ? "brandLogo" : "", updatedAt: Date.now(), updatedBy },
    { merge: true },
  );
  if (epoch !== logoEpoch) return memorySrc;

  setBrandLogoMemory(shrunk, true);
  loadPromise = Promise.resolve(shrunk);
  return shrunk;
}

/**
 * Load brand logo once per session. Safe on login (meta/brandLogo is public-read).
 * Migrates fat data URLs left on businessProfile by the previous build.
 * Also one-shot knocks out white/cream edge pads on older uploads.
 */
export async function loadBrandLogo(): Promise<string> {
  if (memorySrc) return memorySrc;
  if (loadPromise) return loadPromise;

  const epochAtStart = logoEpoch;

  loadPromise = (async () => {
    purgeLegacyBrandLogoStorage();
    try {
      const snap = await getDoc(brandLogoRef());
      // Upload won while we were fetching — keep the uploaded bytes.
      if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;

      const docData = snap.exists() ? (snap.data() as BrandLogoDoc) : null;
      let src = docData ? String(docData.dataUrl || "").trim() : "";
      const alreadyKnocked = Boolean(docData?.lightBgKnockedOut);

      if (!src) {
        const profileSnap = await getDoc(profileRef());
        if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;

        const legacy = profileSnap.exists()
          ? String((profileSnap.data() as { logoUrl?: string })?.logoUrl || "").trim()
          : "";
        if (legacy.startsWith("data:image/")) {
          try {
            src = await prepareAndShrinkLogo(legacy);
            if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;
            await setDoc(
              brandLogoRef(),
              {
                dataUrl: src,
                updatedAt: Date.now(),
                updatedBy: "migrate",
                lightBgKnockedOut: true,
              } satisfies BrandLogoDoc,
              { merge: true },
            );
          } catch {
            src = "";
          }
          if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;
          await setDoc(profileRef(), { logoUrl: src ? "brandLogo" : "" }, { merge: true });
        } else if (isEvidencePhotoRef(legacy)) {
          try {
            const resolved = await resolveEvidencePhotoSrc(legacy);
            src = resolved.startsWith("data:")
              ? await prepareAndShrinkLogo(resolved)
              : "";
            if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;
            if (src) {
              await setDoc(
                brandLogoRef(),
                {
                  dataUrl: src,
                  updatedAt: Date.now(),
                  updatedBy: "migrate",
                  lightBgKnockedOut: true,
                } satisfies BrandLogoDoc,
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
      } else if (!alreadyKnocked || src.length > BRAND_LOGO_MAX_CHARS) {
        try {
          src = await prepareAndShrinkLogo(src);
          if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;
          await setDoc(
            brandLogoRef(),
            {
              dataUrl: src,
              updatedAt: Date.now(),
              updatedBy: alreadyKnocked ? "shrink" : "knockout",
              lightBgKnockedOut: true,
            } satisfies BrandLogoDoc,
            { merge: true },
          );
        } catch {
          /* keep original src if re-encode fails */
        }
      }

      if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;
      setBrandLogoMemory(src, false);
      return memorySrc;
    } catch {
      if (epochAtStart !== logoEpoch || memorySrc) return memorySrc;
      setBrandLogoMemory("", false);
      return "";
    }
  })();

  return loadPromise;
}
