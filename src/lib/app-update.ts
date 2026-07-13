import { APP_BUILD } from "./version";

export type AppVersionPayload = {
  build: number;
  builtAt: string;
};

/** Build baked into this JS bundle — compare against /version.json from server. */
export const CLIENT_BUILD = APP_BUILD;

const VERSION_URL = "/version.json";

export async function fetchServerBuild(): Promise<number | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AppVersionPayload;
    return typeof data.build === "number" ? data.build : null;
  } catch {
    return null;
  }
}

const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when reload would interrupt active form work. */
export function isUserBusyForReload(): boolean {
  if (typeof document === "undefined") return false;

  if (document.body.classList.contains("modal-open")) return true;

  const active = document.activeElement;
  if (active) {
    if (FORM_TAGS.has(active.tagName)) return true;
    if (active instanceof HTMLElement && active.isContentEditable) return true;
  }

  return false;
}
