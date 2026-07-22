/** nPos device class for BO folds: shop tablets / long-lived emulators / blocked installs. */

export type NposDeviceClass = "shop" | "dev" | "blocked";

export function normalizeNposDeviceClass(
  raw: unknown,
  isEmulator?: boolean,
): NposDeviceClass {
  if (raw === "shop" || raw === "dev" || raw === "blocked") return raw;
  return isEmulator === true ? "dev" : "shop";
}

/** Resolve class; blocked wins over disabled ghosts. */
export function resolveNposDeviceClass(input: {
  deviceClass?: string;
  isEmulator?: boolean;
  blocked?: boolean;
}): NposDeviceClass {
  if (input.blocked === true || input.deviceClass === "blocked") return "blocked";
  return normalizeNposDeviceClass(input.deviceClass, input.isEmulator);
}

export function nposDeviceClassLabel(c: NposDeviceClass): string {
  if (c === "shop") return "เครื่องหน้าร้าน";
  if (c === "dev") return "เครื่องพัฒนา";
  return "บล็อก";
}

/**
 * Recover ANDROID_ID from installId when older docs never stored stableKey.
 * Current native id = `npos` + ANDROID_ID (usually 16 hex).
 * Legacy wipe ghosts = `npos` + UUID (32 hex) → cannot recover.
 */
export function resolveStableKey(stableKey: string, installId: string): string {
  const sk = (stableKey || "").trim().toLowerCase();
  if (sk.length >= 8) return sk;
  const compact = (installId || "").replace(/-/g, "").toLowerCase();
  const m = /^npos([a-f0-9]+)$/.exec(compact);
  if (!m) return "";
  const hex = m[1];
  // ANDROID_ID is typically 16 hex; reject UUID-length (32) orphans.
  if (hex.length >= 8 && hex.length <= 20) return hex;
  return "";
}

export function nposGroupKey(stableKey: string, installId: string): string {
  const sk = resolveStableKey(stableKey, installId);
  if (sk) return `sk:${sk}`;
  return `orphan:${installId}`;
}

export function shortStableKey(stableKey: string, installId: string): string {
  const sk = resolveStableKey(stableKey, installId);
  if (sk) return sk.length <= 8 ? sk : sk.slice(-8);
  return installId.replace(/-/g, "").slice(-6).toUpperCase();
}

export type ClassBuckets<T> = {
  shop: T[];
  dev: T[];
  blocked: T[];
};

/** Newest-first within each class. */
export function foldByDeviceClass<T extends { deviceClass: NposDeviceClass; sortAt: number }>(
  rows: T[],
): ClassBuckets<T> {
  const shop: T[] = [];
  const dev: T[] = [];
  const blocked: T[] = [];
  for (const row of rows) {
    if (row.deviceClass === "blocked") blocked.push(row);
    else if (row.deviceClass === "dev") dev.push(row);
    else shop.push(row);
  }
  const byAt = (a: T, b: T) => b.sortAt - a.sortAt;
  shop.sort(byAt);
  dev.sort(byAt);
  blocked.sort(byAt);
  return { shop, dev, blocked };
}

/**
 * Keep newest row per physical machine (resolved stableKey).
 * UUID orphans (no recoverable key) collapse to a single newest row —
 * and drop entirely when any keyed machine exists (same emulator left
 * wipe/reinstall ghosts during early testing).
 */
export function dedupeByStableKey<T extends { stableKey: string; id: string; sortAt: number }>(
  rows: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = nposGroupKey(row.stableKey, row.id);
    const prev = byKey.get(key);
    if (!prev || row.sortAt > prev.sortAt) byKey.set(key, row);
  }

  const keyed: T[] = [];
  const orphans: T[] = [];
  for (const [key, row] of byKey) {
    if (key.startsWith("orphan:")) orphans.push(row);
    else keyed.push(row);
  }

  // One emulator can leave many UUID installIds from early builds — keep at most one.
  orphans.sort((a, b) => b.sortAt - a.sortAt);
  const orphanNewest = orphans[0] ? [orphans[0]] : [];

  if (keyed.length > 0) {
    // Prefer the real stable machine; hide legacy UUID ghosts.
    return keyed.sort((a, b) => b.sortAt - a.sortAt);
  }
  return orphanNewest;
}

/** When any row is "online", drop offline leftovers (except blocked). */
export function preferOnlineRows<
  T extends { sortAt: number; deviceClass?: NposDeviceClass },
>(rows: T[], isOnline: (row: T) => boolean): T[] {
  const blocked = rows.filter((r) => r.deviceClass === "blocked");
  const rest = rows.filter((r) => r.deviceClass !== "blocked");
  if (!rest.some(isOnline)) return rows;
  return [...rest.filter(isOnline), ...blocked];
}
