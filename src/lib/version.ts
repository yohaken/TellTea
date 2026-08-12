/** TellTea web version: 4.xxx — bump APP_BUILD on each production UI/JS ship. */
export const APP_VERSION_MAJOR = 4;
export const APP_BUILD = 785;

export const APP_BUILT_AT =
  process.env.NEXT_PUBLIC_APP_BUILT_AT || "1970-01-01T00:00:00.000Z";

/** e.g. 4.433 */
export function appVersionString(
  major = APP_VERSION_MAJOR,
  build = APP_BUILD,
): string {
  return `${major}.${build}`;
}

/** Deterministic Asia/Bangkok label — same on Node build and browser hydrate. */
export function formatAppBuiltAt(iso = APP_BUILT_AT) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const bangkokMs = date.getTime() + 7 * 60 * 60 * 1000;
  const b = new Date(bangkokMs);
  const dd = String(b.getUTCDate()).padStart(2, "0");
  const mm = String(b.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(b.getUTCFullYear()).slice(-2);
  const hh = String(b.getUTCHours()).padStart(2, "0");
  const mi = String(b.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

/** UI badge: version only (built-at stays in version.json / formatAppBuiltAt). */
export function appVersionLabel() {
  return appVersionString();
}
