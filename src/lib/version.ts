/** Bump APP_BUILD on each production UI/JS ship. */
export const APP_BUILD = 1;

export const APP_BUILT_AT =
  process.env.NEXT_PUBLIC_APP_BUILT_AT || new Date().toISOString();

export function formatAppBuiltAt(iso = APP_BUILT_AT) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function appVersionLabel() {
  return `v${APP_BUILD} · ${formatAppBuiltAt()}`;
}
