/**
 * Expected nPos APK release for BO version compare («เวอร์ชันระบบ»).
 * MUST match `npos-telltea/app/build.gradle` versionName/versionCode on every nPos ship.
 * Gate: `scripts/test-npos-system-ver-sync.mjs` — bumping APK without this pin fails CI.
 *
 * OTA safety: tablets compare **versionCode only** (`manifest.versionCode > local`).
 * versionName is a short display label (same digits as versionCode). Renaming it never
 * blocks or unlocks an update — only a higher versionCode does.
 */
export const NPOS_SYSTEM_VERSION_NAME = "136";
export const NPOS_SYSTEM_VERSION_CODE = 136;

export const NPOS_LATEST_MANIFEST_URL =
  "https://telltea-pos.web.app/downloads/latest.json";

export type NposSystemRelease = {
  versionName: string;
  versionCode: number;
  label: string;
  source: "bundled" | "manifest";
};

/** Short friendly label — prefer one number, never "1.14.112 (134)". */
export function formatNposReleaseLabel(versionName: string, versionCode: number): string {
  const name = (versionName || "").trim();
  const code = Number.isFinite(versionCode) ? Math.floor(versionCode) : 0;
  if (code > 0 && (name === String(code) || !name)) return String(code);
  if (name && code > 0 && name !== String(code)) return `${name} (${code})`;
  if (name) return name;
  if (code > 0) return String(code);
  return "—";
}

export function bundledNposSystemRelease(): NposSystemRelease {
  return {
    versionName: NPOS_SYSTEM_VERSION_NAME,
    versionCode: NPOS_SYSTEM_VERSION_CODE,
    label: formatNposReleaseLabel(NPOS_SYSTEM_VERSION_NAME, NPOS_SYSTEM_VERSION_CODE),
    source: "bundled",
  };
}

/** Fetch live latest.json; fall back to bundled gradle pin. */
export async function fetchNposSystemRelease(
  signal?: AbortSignal,
): Promise<NposSystemRelease> {
  const fallback = bundledNposSystemRelease();
  try {
    const res = await fetch(`${NPOS_LATEST_MANIFEST_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      versionName?: unknown;
      versionCode?: unknown;
    };
    const versionName =
      typeof data.versionName === "string" ? data.versionName.trim() : "";
    const versionCode = Number(data.versionCode);
    if (!versionName || !Number.isFinite(versionCode) || versionCode <= 0) {
      return fallback;
    }
    return {
      versionName,
      versionCode: Math.floor(versionCode),
      label: formatNposReleaseLabel(versionName, Math.floor(versionCode)),
      source: "manifest",
    };
  } catch {
    return fallback;
  }
}

export type NposVersionMatch = "ok" | "behind" | "ahead" | "unknown";

/** Compare client build code to expected system release. */
export function nposVersionMatch(
  clientCode: number,
  systemCode: number,
): NposVersionMatch {
  if (!(clientCode > 0) || !(systemCode > 0)) return "unknown";
  if (clientCode === systemCode) return "ok";
  if (clientCode < systemCode) return "behind";
  return "ahead";
}
