import { POS_BUILD } from "./pos-version";

export type PosVersionPayload = {
  build: number;
  builtAt: string;
  product: "telltea-pos";
};

export const POS_CLIENT_BUILD = POS_BUILD;

const POS_VERSION_URL = "/pos-version.json";

export async function fetchPosServerBuild(): Promise<number | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${POS_VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PosVersionPayload;
    return typeof data.build === "number" ? data.build : null;
  } catch {
    return null;
  }
}
